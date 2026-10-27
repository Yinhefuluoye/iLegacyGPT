#import "WebViewController.h"

@implementation WebViewController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithRed:0.04 green:0.05 blue:0.09 alpha:1.0];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.suppressesIncrementalRendering = NO;
    [config.userContentController addScriptMessageHandler:self name:@"chat"];

    self.webView = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:config];
    self.webView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.webView.opaque = NO;
    self.webView.backgroundColor = [UIColor clearColor];
    self.webView.scrollView.bounces = NO;
    self.webView.scrollView.scrollEnabled = NO;
    [self.view addSubview:self.webView];

    NSString *indexPath = [[NSBundle mainBundle] pathForResource:@"index" ofType:@"html" inDirectory:@"web"];
    if (!indexPath) {
        NSLog(@"[ChatAI] FATAL: web/index.html not found in bundle");
        return;
    }
    NSURL *indexURL = [NSURL fileURLWithPath:indexPath];
    NSURL *readAccessURL = [NSURL fileURLWithPath:[indexPath stringByDeletingLastPathComponent] isDirectory:YES];
    [self.webView loadFileURL:indexURL allowingReadAccessToURL:readAccessURL];

    NSLog(@"[ChatAI] webview loading %@", indexPath);
}

- (BOOL)prefersStatusBarHidden {
    return NO;
}

- (UIStatusBarStyle)preferredStatusBarStyle {
    return UIStatusBarStyleLightContent;
}

- (void)sendToWeb:(NSDictionary *)payload {
    NSError *err = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&err];
    if (!data) {
        NSLog(@"[ChatAI] bridge serialize failed: %@", err);
        return;
    }
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.__onNative && window.__onNative(%@);", json];
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.webView evaluateJavaScript:js completionHandler:^(id result, NSError *error) {
            if (error) {
                NSLog(@"[ChatAI] evaluateJavaScript error: %@", error);
            }
        }];
    });
}

#pragma mark - WKScriptMessageHandler

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.name isEqualToString:@"chat"]) {
        return;
    }
    id body = message.body;
    NSLog(@"[ChatAI] bridge message: %@", body);
    [self sendToWeb:@{
        @"type": @"ready",
        @"build": @"hello-1",
        @"echo": (body ? body : [NSNull null])
    }];
}

@end
