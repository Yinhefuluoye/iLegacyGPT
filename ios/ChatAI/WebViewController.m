#import "WebViewController.h"
#import "ChatConfig.h"
#import "ChatStore.h"
#import "AIService.h"
#import "AppDelegate.h"

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
@property (nonatomic, copy) NSString *cancelledRequestId;
@property (nonatomic, assign) BOOL didSendReady;
@property (nonatomic, assign) CGFloat keyboardOverlap;

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
    // The page is light: dark status bar text, otherwise white-on-white looks
    // like a rendering glitch at the top of the screen.
    return UIStatusBarStyleDefault;
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    [self layoutWebView];
}

- (CGFloat)statusBarInset {
    UIApplication *app = [UIApplication sharedApplication];
    return app.statusBarHidden ? 0.0 : app.statusBarFrame.size.height;
}

// Shrink the page itself when the keyboard is up: the composer then sits right
// above the keyboard instead of relying on a CSS padding guess (which drifted
// after a few turns on iOS 10).
- (void)layoutWebView {
    CGRect bounds = self.view.bounds;
    CGFloat top = [self statusBarInset];
    CGFloat bottom = self.keyboardOverlap;
    CGFloat height = MAX(0.0, bounds.size.height - top - bottom);
    self.webView.frame = CGRectMake(bounds.origin.x, bounds.origin.y + top, bounds.size.width, height);
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
        self.cancelledRequestId = nil;
        NSString *rid = [self startChatWithSearch:cfg
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
        self.cancelledRequestId = requestId ?: @"";
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
    self.keyboardOverlap = overlap;
    [self layoutWebView];
    [self sendToWeb:@{ @"type": @"keyboard", @"height": @(lroundf(overlap)) }];
}

#pragma mark - Web search

static NSString *SearchJSONEscape(NSString *text) {
    NSMutableString *out = [NSMutableString stringWithString:text ?: @""];
    [out replaceOccurrencesOfString:@"\\" withString:@"\\\\" options:0 range:NSMakeRange(0, out.length)];
    [out replaceOccurrencesOfString:@"\"" withString:@"\\\"" options:0 range:NSMakeRange(0, out.length)];
    [out replaceOccurrencesOfString:@"\n" withString:@"\\n" options:0 range:NSMakeRange(0, out.length)];
    [out replaceOccurrencesOfString:@"\r" withString:@"" options:0 range:NSMakeRange(0, out.length)];
    [out replaceOccurrencesOfString:@"\t" withString:@" " options:0 range:NSMakeRange(0, out.length)];
    return out;
}

// Injected when the model asked for a search but nothing usable came back.
static NSString *SearchFailureNote(void) {
    return @"【系统说明】客户端已经替你检索过网络，但这次没有取到可用的网页结果。"
            "请如实说明未能获取实时资料，并基于已有知识作答；不要编造链接或来源。";
}

static id SearchValueAtPath(id object, NSString *path) {
    if (![path isKindOfClass:[NSString class]] || path.length == 0) {
        return nil;
    }
    id current = object;
    for (NSString *part in [path componentsSeparatedByString:@"."]) {
        if (![current isKindOfClass:[NSDictionary class]]) {
            return nil;
        }
        current = ((NSDictionary *)current)[part];
        if (!current || [current isKindOfClass:[NSNull class]]) {
            return nil;
        }
    }
    return current;
}

- (NSString *)searchLastUserText:(NSArray *)messages {
    for (NSInteger i = (NSInteger)messages.count - 1; i >= 0; i--) {
        id item = messages[(NSUInteger)i];
        if (![item isKindOfClass:[NSDictionary class]]) {
            continue;
        }
        if ([item[@"role"] isEqualToString:@"user"]) {
            id content = item[@"content"];
            if ([content isKindOfClass:[NSString class]] && [content length]) {
                return content;
            }
            if ([content isKindOfClass:[NSArray class]]) {
                for (id part in content) {
                    if ([part isKindOfClass:[NSDictionary class]] && [part[@"text"] isKindOfClass:[NSString class]]) {
                        return part[@"text"];
                    }
                }
            }
        }
    }
    return nil;
}

- (NSArray *)searchResultsInJSON:(id)json {
    NSArray *paths = @[@"results", @"data", @"items", @"organic", @"web.results", @"documents", @"hits"];
    for (NSString *path in paths) {
        id value = SearchValueAtPath(json, path);
        if ([value isKindOfClass:[NSArray class]] && [value count]) {
            return value;
        }
    }
    return [json isKindOfClass:[NSArray class]] ? json : @[];
}

- (NSString *)searchStringInItem:(id)item keys:(NSArray *)keys {
    if (![item isKindOfClass:[NSDictionary class]]) {
        return nil;
    }
    for (NSString *key in keys) {
        id value = ((NSDictionary *)item)[key];
        if ([value isKindOfClass:[NSString class]] && [value length]) {
            return value;
        }
    }
    return nil;
}

- (NSInteger)searchNumber:(id)value fallback:(NSInteger)fallback {
    if ([value respondsToSelector:@selector(integerValue)]) {
        NSInteger number = [value integerValue];
        if (number > 0) {
            return MIN(number, 10);
        }
    }
    return fallback;
}

- (void)runSearchForQuery:(NSString *)query
                   config:(NSDictionary *)cfg
                 requestId:(NSString *)requestId
               completion:(void (^)(NSString *context, NSArray *items))completion {
    NSDictionary *search = [cfg[@"search"] isKindOfClass:[NSDictionary class]] ? cfg[@"search"] : nil;
    NSString *urlString = [search[@"url"] isKindOfClass:[NSString class]] ? search[@"url"] : @"";
    NSString *key = [search[@"key"] isKindOfClass:[NSString class]] ? search[@"key"] : @"";
    urlString = [urlString stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (urlString.length == 0 || query.length == 0) {
        completion(nil, nil);
        return;
    }
    NSURL *url = [NSURL URLWithString:urlString];
    if (!url) {
        completion(nil, nil);
        return;
    }
    NSInteger num = [self searchNumber:search[@"num"] fallback:5];
    NSString *template = [search[@"body"] isKindOfClass:[NSString class]] ? search[@"body"] : @"";
    if (template.length == 0) {
        template = @"{\"query\":\"{{query}}\",\"num_results\":{{num}}}";
    }
    NSString *bodyString = [template stringByReplacingOccurrencesOfString:@"{{query}}" withString:SearchJSONEscape(query)];
    bodyString = [bodyString stringByReplacingOccurrencesOfString:@"{{num}}" withString:[NSString stringWithFormat:@"%ld", (long)num]];
    bodyString = [bodyString stringByReplacingOccurrencesOfString:@"{{key}}" withString:SearchJSONEscape(key)];

    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    request.timeoutInterval = 20.0;
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    NSString *headerName = [search[@"header"] isKindOfClass:[NSString class]] ? search[@"header"] : @"Authorization";
    NSString *prefix = [search[@"prefix"] isKindOfClass:[NSString class]] ? search[@"prefix"] : @"Bearer ";
    if (headerName.length == 0) {
        headerName = @"Authorization";
    }
    if (key.length) {
        [request setValue:[prefix stringByAppendingString:key] forHTTPHeaderField:headerName];
    }
    request.HTTPBody = [bodyString dataUsingEncoding:NSUTF8StringEncoding];

    __weak typeof(self) weakSelf = self;
    NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (error || data.length == 0) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(nil, nil);
            });
            return;
        }
        id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        NSArray *results = [weakSelf searchResultsInJSON:json];
        NSMutableArray *items = [NSMutableArray array];
        NSMutableString *context = [NSMutableString string];
        NSInteger index = 0;
        for (id result in results) {
            if (index >= num) {
                break;
            }
            NSString *title = [weakSelf searchStringInItem:result keys:@[@"title", @"name", @"headline"]];
            NSString *link = [weakSelf searchStringInItem:result keys:@[@"url", @"link", @"href"]];
            NSString *snippet = [weakSelf searchStringInItem:result
                keys:@[@"text", @"content", @"snippet", @"description", @"summary"]];
            if (snippet.length > 320) {
                snippet = [[snippet substringToIndex:320] stringByAppendingString:@"…"];
            }
            if (!title.length && !snippet.length) {
                continue;
            }
            index += 1;
            [context appendFormat:@"[%ld] %@\n%@\n%@\n\n", (long)index,
                title.length ? title : @"(无标题)", snippet.length ? snippet : @"", link.length ? link : @""];
            [items addObject:@{ @"index": @(index),
                                @"title": title.length ? title : @"(无标题)",
                                @"url": link.length ? link : @"",
                                @"snippet": snippet.length ? snippet : @"" }];
        }
        NSString *final = context.length
            ? [NSString stringWithFormat:
                @"【系统说明】你当前已接入实时网络：下面是客户端刚刚替你从网络检索到的真实网页内容（共 %ld 条）。"
                @"请直接依据这些资料回答，并用 [1]、[2] 标注来源；"
                @"检索已经完成，你不需要也不能再发起搜索。不要声称自己无法联网、无法获取实时信息或要求用户自行搜索；"
                @"也不要输出任何 JSON、工具调用、<tool_call> 标签或搜索请求，只输出给用户看的正文。"
                @"资料不足时如实说明不足，不要编造。\n\n%@",
                (long)items.count, context]
            : nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (items.count) {
                [weakSelf sendToWeb:@{ @"type": @"sources", @"requestId": requestId ?: @"", @"items": items }];
            }
            completion(final, items);
        });
    }];
    [task resume];
}

- (NSArray *)searchMessagesByInjecting:(NSString *)context into:(NSArray *)messages {
    NSMutableArray *out = [NSMutableArray arrayWithCapacity:messages.count + 1];
    [out addObject:@{ @"role": @"system", @"content": context }];
    [out addObjectsFromArray:messages ?: @[]];
    return out;
}

// Ask the model (cheap, non-streaming) whether this turn needs a web search.
// Output contract: {"query":"..."} or {"query":""}. Falls back to "no search"
// when the endpoint or model does not cooperate, so the chat never blocks.
- (void)decideSearchQueryFor:(NSString *)question
                      config:(NSDictionary *)cfg
                  completion:(void (^)(NSString *query))completion {
    NSString *base = [ChatConfig normalizedBaseURL:cfg];
    NSString *urlString = [base hasSuffix:@"/chat/completions"] ? base
        : [base stringByAppendingString:@"/chat/completions"];
    NSString *key = [ChatConfig apiKeyFromConfig:cfg];
    NSString *model = [ChatConfig modelFromConfig:cfg];
    NSURL *url = [NSURL URLWithString:urlString];
    if (!url || question.length == 0) {
        completion(nil);
        return;
    }
    NSString *system = @"You are a search planner. Decide if answering the user needs fresh web information "
                        "(news, prices, weather, specific facts you are unsure about). "
                        "Reply with strict JSON only: {\"query\":\"search keywords\"} when needed, "
                        "or {\"query\":\"\"} when the question can be answered without the web. Prefer queries that would surface concrete article pages (news posts, docs, blog entries) rather than homepages or section index pages.";
    NSDictionary *body = @{
        @"model": model.length ? model : @"gpt-4o-mini",
        @"messages": @[ @{ @"role": @"system", @"content": system },
                        @{ @"role": @"user", @"content": question } ],
        @"stream": @NO,
        @"max_tokens": @100,
        @"temperature": @0
    };
    NSData *bodyData = [NSJSONSerialization dataWithJSONObject:body options:0 error:NULL];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    request.timeoutInterval = 20.0;
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    if (key.length) {
        [request setValue:[@"Bearer " stringByAppendingString:key] forHTTPHeaderField:@"Authorization"];
    }
    request.HTTPBody = bodyData;
    NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSString *picked = nil;
        if (!error && data.length) {
            id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
            NSString *content = [self valueAtChatContent:json];
            if (content.length) {
                NSRange start = [content rangeOfString:@"{"];
                NSRange end = [content rangeOfString:@"}" options:NSBackwardsSearch];
                if (start.location != NSNotFound && end.location != NSNotFound && end.location >= start.location) {
                    NSString *snippet = [content substringWithRange:
                        NSMakeRange(start.location, end.location - start.location + 1)];
                    NSData *snippetData = [snippet dataUsingEncoding:NSUTF8StringEncoding];
                    id parsed = [NSJSONSerialization JSONObjectWithData:snippetData options:0 error:NULL];
                    if ([parsed isKindOfClass:[NSDictionary class]]) {
                        id q = parsed[@"query"];
                        if ([q isKindOfClass:[NSString class]]) {
                            picked = [q stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
                        }
                    }
                }
            }
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            completion(picked.length ? picked : nil);
        });
    }];
    [task resume];
}

- (NSString *)valueAtChatContent:(id)json {
    if (![json isKindOfClass:[NSDictionary class]]) {
        return nil;
    }
    id choices = json[@"choices"];
    if (![choices isKindOfClass:[NSArray class]] || [choices count] == 0) {
        return nil;
    }
    id message = choices[0][@"message"];
    id content = message[@"content"];
    return [content isKindOfClass:[NSString class]] ? content : nil;
}

// Runs several search queries one after another and merges their context, so a
// model that sends two queries (often the topic plus the date) gets both.
- (void)runQueries:(NSArray *)queries
             index:(NSUInteger)index
            merged:(NSMutableString *)merged
            config:(NSDictionary *)cfg
         requestId:(NSString *)requestId
        completion:(void (^)(NSString *context))completion {
    if (index >= queries.count) {
        completion(merged.length ? [merged copy] : nil);
        return;
    }
    id item = queries[index];
    NSString *query = [item isKindOfClass:[NSString class]] ? item : @"";
    if (query.length == 0) {
        [self runQueries:queries index:index + 1 merged:merged config:cfg
                requestId:requestId completion:completion];
        return;
    }
    __weak WebViewController *weakSelf = self;
    [self runSearchForQuery:query config:cfg requestId:requestId
                 completion:^(NSString *context, NSArray *items) {
        (void)items;
        WebViewController *strongSelf = weakSelf;
        if (!strongSelf) {
            return;
        }
        NSString *rid = requestId ?: @"";
        if (rid.length && [strongSelf.cancelledRequestId isEqualToString:rid]) {
            return;
        }
        if (context.length) {
            if (merged.length) {
                [merged appendString:@"\n\n"];
            }
            [merged appendString:context];
        }
        [strongSelf runQueries:queries index:index + 1 merged:merged config:cfg
                    requestId:requestId completion:completion];
    }];
}

// Chat entry point.
//   off   -> plain request, no tools
//   force -> always search first, then answer once with the results injected
//   auto  -> advertise a real `web_search` tool and let the model decide; the
//            follow-up round runs with tools off so a turn can never loop.
// The 0.6.x search-planner path is kept as a fallback for endpoints that reject
// `tools` (HTTP 400/422), so auto still searches on non-tool models.
- (NSString *)startChatWithSearch:(NSDictionary *)config
                        requestId:(NSString *)requestId
                         messages:(NSArray *)messages
                            image:(NSDictionary *)image
                         thinking:(NSDictionary *)thinking
                          onDelta:(AIDeltaBlock)onDelta
                      onReasoning:(AIDeltaBlock)onReasoning
                           onDone:(AIDoneBlock)onDone
                          onError:(AIErrorBlock)onError {
    NSDictionary *searchCfg = [config[@"search"] isKindOfClass:[NSDictionary class]] ? config[@"search"] : @{};
    NSString *mode = [searchCfg[@"mode"] isKindOfClass:[NSString class]] ? searchCfg[@"mode"] : @"off";
    NSString *question = [self searchLastUserText:messages];
    NSString *rid = requestId ?: @"";
    __weak WebViewController *weakSelf = self;

    // Follow-up round: same conversation, search results injected, tools off.
    NSMutableDictionary *noToolsConfig = [config mutableCopy] ?: [NSMutableDictionary dictionary];
    NSMutableDictionary *noToolsSearch = [searchCfg mutableCopy] ?: [NSMutableDictionary dictionary];
    noToolsSearch[@"noTools"] = @YES;
    noToolsConfig[@"search"] = noToolsSearch;

    // Answers with the given prefetched context injected as a system message
    // (empty context = answer from the model's own knowledge).
    void (^answerWith)(NSString *context) = ^(NSString *context) {
        WebViewController *strongSelf = weakSelf;
        if (!strongSelf) {
            return;
        }
        NSArray *finalMessages = context.length
            ? [strongSelf searchMessagesByInjecting:context into:messages]
            : messages;
        [strongSelf.ai startChatWithConfig:noToolsConfig requestId:requestId messages:finalMessages
                                     image:image thinking:thinking
                                   onDelta:onDelta onReasoning:onReasoning
                                    onDone:onDone onError:onError];
    };

    // Searches for one query, then answers once with the results injected.
    void (^searchThenAnswer)(NSString *searchQuery) = ^(NSString *searchQuery) {
        WebViewController *strongSelf = weakSelf;
        if (!strongSelf) {
            return;
        }
        if (searchQuery.length == 0) {
            answerWith(nil);
            return;
        }
        [strongSelf sendToWeb:@{ @"type": @"searching", @"requestId": rid }];
        [strongSelf runSearchForQuery:searchQuery config:config requestId:requestId
                           completion:^(NSString *context, NSArray *items) {
            (void)items;
            WebViewController *inner = weakSelf;
            if (!inner) {
                return;
            }
            if (rid.length && [inner.cancelledRequestId isEqualToString:rid]) {
                return;
            }
            answerWith(context.length ? context : SearchFailureNote());
        }];
    };

    // The model asked for the web: search (up to two queries, merged), then let
// the caller issue the follow-up request. Returning YES keeps this round from
// emitting `done`.
    AIToolCallBlock toolHandler = ^BOOL(NSArray *queries) {
        WebViewController *strongSelf = weakSelf;
        if (!strongSelf) {
            return NO;
        }
        NSMutableArray *run = [NSMutableArray array];
        for (id item in queries) {
            if ([item isKindOfClass:[NSString class]]) {
                NSString *text = [(NSString *)item stringByTrimmingCharactersInSet:
                                  [NSCharacterSet whitespaceAndNewlineCharacterSet]];
                if (text.length) {
                    [run addObject:text];
                    if (run.count >= 2) {
                        break;
                    }
                }
            }
        }
        if (run.count == 0 && question.length) {
            // the model improvised an argument object the parser does not know
            [run addObject:question];
        }
        if (run.count == 0) {
            return NO;
        }
        [strongSelf sendToWeb:@{ @"type": @"searching", @"requestId": rid }];
        [strongSelf runQueries:run
                         index:0
                        merged:[NSMutableString string]
                        config:config
                     requestId:requestId
                    completion:^(NSString *context) {
            answerWith(context.length ? context : SearchFailureNote());
        }];
        return YES;
    };

    // Endpoint rejected `tools` -> degrade to the planner path once.
    __block BOOL retriedWithoutTools = NO;
    AIErrorBlock errorWrap = ^(NSString *message, NSInteger code) {
        WebViewController *strongSelf = weakSelf;
        if (!strongSelf) {
            return;
        }
        BOOL toolRejected = (code == 400 || code == 422);
        if (!retriedWithoutTools && toolRejected && [mode isEqualToString:@"auto"]) {
            retriedWithoutTools = YES;
            strongSelf.ai.toolCallHandler = nil;
            [strongSelf appendLog:[NSString stringWithFormat:@"tools rejected (%ld); using search planner", (long)code]];
            [strongSelf decideSearchQueryFor:question config:config completion:^(NSString *decided) {
                if (decided.length) {
                    searchThenAnswer(decided);
                } else {
                    answerWith(nil);
                }
            }];
            return;
        }
        if (onError) {
            onError(message, code);
        }
    };

    if ([mode isEqualToString:@"off"] || question.length == 0) {
        self.ai.toolCallHandler = nil;
        return [self.ai startChatWithConfig:config requestId:requestId messages:messages
                                      image:image thinking:thinking
                                    onDelta:onDelta onReasoning:onReasoning
                                     onDone:onDone onError:onError];
    }
    if ([mode isEqualToString:@"force"]) {
        self.ai.toolCallHandler = nil;
        searchThenAnswer(question);
        return requestId;
    }
    // auto: the model itself decides whether this turn needs the live web.
    self.ai.toolCallHandler = toolHandler;
    return [self.ai startChatWithConfig:config requestId:requestId messages:messages
                                  image:image thinking:thinking
                                onDelta:onDelta onReasoning:onReasoning
                                 onDone:onDone onError:errorWrap];
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
    /* UIImagePickerController presented modally on iPad rotates to portrait on its
       own and re-lays out the page behind it. Hold the current orientation while
       the picker is on screen, then release it on dismissal. */
    CGSize screenSize = self.view.window ? self.view.window.bounds.size
                                         : [UIScreen mainScreen].bounds.size;
    [AppDelegate lockOrientation:screenSize.width > screenSize.height
        ? (UIInterfaceOrientationMaskLandscapeLeft | UIInterfaceOrientationMaskLandscapeRight)
        : (UIInterfaceOrientationMaskPortrait | UIInterfaceOrientationMaskPortraitUpsideDown)];
    [self presentViewController:picker animated:YES completion:nil];
}

- (void)imagePickerController:(UIImagePickerController *)picker
didFinishPickingMediaWithInfo:(NSDictionary *)info {
    UIImage *image = info[UIImagePickerControllerOriginalImage];
    NSString *requestId = self.pendingImageRequestId;
    self.pendingImageRequestId = nil;
    [picker dismissViewControllerAnimated:YES completion:nil];
    [AppDelegate unlockOrientation];
    [UIViewController attemptRotationToDeviceOrientation];
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
    [AppDelegate unlockOrientation];
    [UIViewController attemptRotationToDeviceOrientation];
    NSString *requestId = self.pendingImageRequestId;
    self.pendingImageRequestId = nil;
    [self sendToWeb:@{ @"type": @"cancel", @"requestId": requestId ?: @"" }];
}

@end
