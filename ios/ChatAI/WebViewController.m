#import "WebViewController.h"
#import "ChatConfig.h"
#import "ChatStore.h"
#import "AIService.h"

static UIImage *ScaleImageToMaxSide(UIImage *image, CGFloat maxSide) {
    if (!image) {
        return nil;
    }
    CGSize size = image.size;
    CGFloat maxDim = MAX(size.width, size.height);
    if (maxDim <= 0 || maxDim <= maxSide) {
        return image;
    }
    CGFloat scale = maxSide / maxDim;
    CGSize target = CGSizeMake(floorf(size.width * scale), floorf(size.height * scale));
    UIGraphicsBeginImageContextWithOptions(target, NO, 1.0);
    [image drawInRect:CGRectMake(0, 0, target.width, target.height)];
    UIImage *scaled = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    return scaled ?: image;
}

@interface WebViewController () <WKNavigationDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate>

@property (nonatomic, strong) AIService *ai;
@property (nonatomic, strong) NSMutableArray *logs;
@property (nonatomic, copy) NSString *pendingImageRequestId;
@property (nonatomic, assign) BOOL didSendReady;

@end

@implementation WebViewController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithRed:0.02 green:0.03 blue:0.06 alpha:1.0];
    self.logs = [NSMutableArray array];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.suppressesIncrementalRendering = NO;
    config.allowsInlineMediaPlayback = YES;
    [config.userContentController addScriptMessageHandler:self name:@"chat"];

    self.webView = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:config];
    self.webView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.webView.opaque = NO;
    self.webView.backgroundColor = [UIColor clearColor];
    self.webView.scrollView.bounces = NO;
    self.webView.scrollView.scrollEnabled = NO;
    self.webView.scrollView.scrollsToTop = NO;
    self.webView.navigationDelegate = self;
    [self.view addSubview:self.webView];

    self.ai = [[AIService alloc] init];

    NSString *indexPath = [[NSBundle mainBundle] pathForResource:@"index" ofType:@"html" inDirectory:@"web"];
    if (!indexPath) {
        [self appendLog:@"FATAL: web/index.html not found in bundle"];
        return;
    }
    NSURL *indexURL = [NSURL fileURLWithPath:indexPath];
    NSURL *readAccessURL = [NSURL fileURLWithPath:[indexPath stringByDeletingLastPathComponent] isDirectory:YES];
    [self.webView loadFileURL:indexURL allowingReadAccessToURL:readAccessURL];
    [self appendLog:[NSString stringWithFormat:@"loading webview: %@", indexPath]];

    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
    [nc addObserver:self selector:@selector(keyboardFrameChanged:) name:UIKeyboardWillChangeFrameNotification object:nil];
    [nc addObserver:self selector:@selector(keyboardFrameChanged:) name:UIKeyboardWillShowNotification object:nil];
    [nc addObserver:self selector:@selector(keyboardFrameChanged:) name:UIKeyboardWillHideNotification object:nil];
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (BOOL)prefersStatusBarHidden {
    return NO;
}

- (UIStatusBarStyle)preferredStatusBarStyle {
    return UIStatusBarStyleLightContent;
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    self.webView.frame = self.view.bounds;
}

#pragma mark - Bridge out

- (void)appendLog:(NSString *)text {
    if (![text isKindOfClass:[NSString class]]) {
        return;
    }
    NSLog(@"[ChatAI] %@", text);
    @synchronized (self.logs) {
        [self.logs addObject:text];
        while (self.logs.count > 300) {
            [self.logs removeObjectAtIndex:0];
        }
    }
}

- (void)sendToWeb:(NSDictionary *)payload {
    if (![payload isKindOfClass:[NSDictionary class]]) {
        return;
    }
    void (^send)(void) = ^{
        NSError *err = nil;
        NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&err];
        if (!data) {
            NSLog(@"[ChatAI] bridge serialize failed: %@", err);
            return;
        }
        NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        NSString *js = [NSString stringWithFormat:@"window.__onNative && window.__onNative(%@);", json];
        [self.webView evaluateJavaScript:js completionHandler:^(id result, NSError *error) {
            if (error) {
                NSLog(@"[ChatAI] evaluateJavaScript error: %@", error.localizedDescription);
            }
        }];
    };
    if ([NSThread isMainThread]) {
        send();
    } else {
        dispatch_async(dispatch_get_main_queue(), send);
    }
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.name isEqualToString:@"chat"]) {
        return;
    }
    id body = message.body;
    if ([body isKindOfClass:[NSDictionary class]]) {
        [self handleBridgeBody:(NSDictionary *)body];
    } else {
        [self appendLog:[NSString stringWithFormat:@"bridge non-dict message: %@", body]];
    }
}

- (void)handleBridgeBody:(NSDictionary *)body {
    NSString *op = body[@"op"];
    if (![op isKindOfClass:[NSString class]]) {
        return;
    }
    NSString *requestId = body[@"requestId"];
    if (![requestId isKindOfClass:[NSString class]] || requestId.length == 0) {
        requestId = [[NSUUID UUID] UUIDString];
    }

    if ([op isEqualToString:@"config.get"]) {
        [self sendToWeb:@{ @"type": @"config", @"config": [ChatConfig load] }];
        return;
    }
    if ([op isEqualToString:@"config.set"]) {
        id cfg = body[@"config"];
        if ([cfg isKindOfClass:[NSDictionary class]]) {
            [ChatConfig save:cfg];
            [self appendLog:@"config saved"];
        }
        [self sendToWeb:@{ @"type": @"config", @"config": [ChatConfig load] }];
        return;
    }
    if ([op isEqualToString:@"models.fetch"]) {
        NSDictionary *cfg = [body[@"config"] isKindOfClass:[NSDictionary class]] ? body[@"config"] : [ChatConfig load];
        __weak typeof(self) weakSelf = self;
        [self.ai fetchModelsWithConfig:cfg completion:^(NSArray *models, id raw, NSString *errorMessage) {
            if (errorMessage) {
                [weakSelf sendToWeb:@{ @"type": @"error", @"context": @"models", @"message": errorMessage }];
                [weakSelf appendLog:[NSString stringWithFormat:@"models error: %@", errorMessage]];
            } else {
                [weakSelf sendToWeb:@{ @"type": @"models",
                                       @"models": models ?: @[],
                                       @"raw": raw ?: [NSNull null] }];
                [weakSelf appendLog:[NSString stringWithFormat:@"models loaded: %lu", (unsigned long)models.count]];
            }
        }];
        return;
    }
    if ([op isEqualToString:@"chat.start"]) {
        NSDictionary *cfg = [body[@"config"] isKindOfClass:[NSDictionary class]] ? body[@"config"] : [ChatConfig load];
        NSArray *messages = [body[@"messages"] isKindOfClass:[NSArray class]] ? body[@"messages"] : @[];
        NSDictionary *image = [body[@"image"] isKindOfClass:[NSDictionary class]] ? body[@"image"] : nil;
        NSDictionary *thinking = [body[@"thinking"] isKindOfClass:[NSDictionary class]] ? body[@"thinking"] : nil;
        __weak typeof(self) weakSelf = self;
        NSString *rid = [self.ai startChatWithConfig:cfg
                                          requestId:requestId
                                           messages:messages
                                              image:image
                                           thinking:thinking
                                            onDelta:^(NSString *text) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [weakSelf sendToWeb:@{ @"type": @"delta", @"requestId": requestId, @"text": text ?: @"" }];
            });
        } onReasoning:^(NSString *text) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [weakSelf sendToWeb:@{ @"type": @"reasoning", @"requestId": requestId, @"text": text ?: @"" }];
            });
        } onDone:^(NSDictionary *usage) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [weakSelf sendToWeb:@{ @"type": @"done", @"requestId": requestId, @"usage": usage ?: [NSNull null] }];
            });
        } onError:^(NSString *message, NSInteger code) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [weakSelf sendToWeb:@{ @"type": @"error", @"requestId": requestId,
                                       @"message": message ?: @"未知错误", @"code": @(code) }];
                [weakSelf appendLog:[NSString stringWithFormat:@"chat error(%ld): %@", (long)code, message]];
            });
        }];
        (void)rid;
        return;
    }
    if ([op isEqualToString:@"chat.stop"]) {
        [self.ai stopRequest:requestId];
        [self sendToWeb:@{ @"type": @"aborted", @"requestId": requestId }];
        return;
    }
    if ([op isEqualToString:@"image.pick"]) {
        NSString *source = body[@"source"];
        [self presentImagePicker:[source isEqualToString:@"camera"] requestId:requestId];
        return;
    }
    if ([op isEqualToString:@"store.load"]) {
        [self sendToWeb:@{ @"type": @"store", @"data": [ChatStore load] }];
        return;
    }
    if ([op isEqualToString:@"store.save"]) {
        id data = body[@"data"];
        if ([data isKindOfClass:[NSDictionary class]]) {
            [ChatStore save:data];
        }
        [self sendToWeb:@{ @"type": @"ok", @"op": @"store.save" }];
        return;
    }
    if ([op isEqualToString:@"store.clear"]) {
        [ChatStore clear];
        [self sendToWeb:@{ @"type": @"ok", @"op": @"store.clear" }];
        return;
    }
    if ([op isEqualToString:@"log.write"]) {
        id text = body[@"text"];
        if ([text isKindOfClass:[NSString class]]) {
            [self appendLog:text];
        }
        return;
    }
    if ([op isEqualToString:@"diag.get"]) {
        NSArray *logs = nil;
        @synchronized (self.logs) {
            logs = [self.logs copy];
        }
        [self sendToWeb:@{ @"type": @"diag", @"logs": logs ?: @[], @"build": [self buildString] }];
        return;
    }
    [self appendLog:[NSString stringWithFormat:@"unknown bridge op: %@", op]];
}

- (NSString *)buildString {
    NSDictionary *info = [[NSBundle mainBundle] infoDictionary];
    NSString *shortVersion = info[@"CFBundleShortVersionString"] ?: @"?";
    NSString *build = info[@"CFBundleVersion"] ?: @"?";
    return [NSString stringWithFormat:@"%@ (%@)", shortVersion, build];
}

#pragma mark - Web navigation

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    if (self.didSendReady) {
        return;
    }
    self.didSendReady = YES;
    [self appendLog:@"webview ready"];
    [self sendToWeb:@{
        @"type": @"ready",
        @"build": [self buildString],
        @"platform": [NSString stringWithFormat:@"%@ %@", [[UIDevice currentDevice] systemName],
                      [[UIDevice currentDevice] systemVersion]]
    }];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self appendLog:[NSString stringWithFormat:@"webview fail: %@", error.localizedDescription]];
}

#pragma mark - Keyboard

- (void)keyboardFrameChanged:(NSNotification *)note {
    NSDictionary *info = note.userInfo;
    CGRect endFrame = [info[UIKeyboardFrameEndUserInfoKey] CGRectValue];
    CGRect inView = [self.view convertRect:endFrame fromView:nil];
    CGFloat overlap = MAX(0.0, CGRectGetMaxY(self.view.bounds) - CGRectGetMinY(inView));
    [self sendToWeb:@{ @"type": @"keyboard", @"height": @(lroundf(overlap)) }];
}

#pragma mark - Image picker

- (void)presentImagePicker:(BOOL)useCamera requestId:(NSString *)requestId {
    UIImagePickerControllerSourceType source = useCamera ? UIImagePickerControllerSourceTypeCamera
                                                        : UIImagePickerControllerSourceTypePhotoLibrary;
    if (![UIImagePickerController isSourceTypeAvailable:source]) {
        [self sendToWeb:@{ @"type": @"error", @"context": @"image",
                           @"message": @"此设备不支持该图片来源" }];
        return;
    }
    self.pendingImageRequestId = requestId;
    UIImagePickerController *picker = [[UIImagePickerController alloc] init];
    picker.sourceType = source;
    picker.delegate = self;
    picker.allowsEditing = NO;
    [self presentViewController:picker animated:YES completion:nil];
}

- (void)imagePickerController:(UIImagePickerController *)picker
didFinishPickingMediaWithInfo:(NSDictionary *)info {
    UIImage *image = info[UIImagePickerControllerOriginalImage];
    NSString *requestId = self.pendingImageRequestId;
    self.pendingImageRequestId = nil;
    [picker dismissViewControllerAnimated:YES completion:nil];
    if (!image) {
        [self sendToWeb:@{ @"type": @"cancel", @"requestId": requestId ?: @"" }];
        return;
    }
    __weak typeof(self) weakSelf = self;
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        UIImage *scaled = ScaleImageToMaxSide(image, 1568.0);
        NSData *jpeg = UIImageJPEGRepresentation(scaled, 0.8);
        NSString *base64 = [jpeg base64EncodedStringWithOptions:0];
        NSDictionary *payload = @{
            @"type": @"image",
            @"requestId": requestId ?: @"",
            @"image": @{
                @"mime": @"image/jpeg",
                @"dataBase64": base64 ?: @"",
                @"width": @((int)lroundf(scaled.size.width)),
                @"height": @((int)lroundf(scaled.size.height))
            }
        };
        dispatch_async(dispatch_get_main_queue(), ^{
            [weakSelf sendToWeb:payload];
            [weakSelf appendLog:[NSString stringWithFormat:@"image picked: %.0fx%.0f %.1fKB",
                                 scaled.size.width, scaled.size.height, jpeg.length / 1024.0]];
        });
    });
}

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker {
    [picker dismissViewControllerAnimated:YES completion:nil];
    NSString *requestId = self.pendingImageRequestId;
    self.pendingImageRequestId = nil;
    [self sendToWeb:@{ @"type": @"cancel", @"requestId": requestId ?: @"" }];
}

@end
