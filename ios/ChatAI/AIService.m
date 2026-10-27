#import "AIService.h"
#import "ChatConfig.h"
#import <UIKit/UIKit.h>

#pragma mark - Stream state

@interface AIStreamState : NSObject
@property (nonatomic, copy) NSString *requestId;
@property (nonatomic, strong) NSMutableData *lineBuffer;
@property (nonatomic, strong) NSMutableString *pendingText;
@property (nonatomic, strong) NSMutableString *pendingReasoning;
@property (nonatomic, strong) NSMutableData *body;
@property (nonatomic, assign) NSInteger statusCode;
@property (nonatomic, assign) BOOL isEventStream;
@property (nonatomic, assign) BOOL finished;
@property (nonatomic, assign) BOOL stopped;
@property (nonatomic, assign) BOOL flushScheduled;
@property (nonatomic, strong) NSDictionary *usage;
@property (nonatomic, copy) AIDeltaBlock onDelta;
@property (nonatomic, copy) AIDeltaBlock onReasoning;
@property (nonatomic, copy) AIDoneBlock onDone;
@property (nonatomic, copy) AIErrorBlock onError;
@property (nonatomic, strong) NSURLSessionDataTask *task;
@end

@implementation AIStreamState
@end

#pragma mark - Helpers

static NSString *Trimmed(NSString *s) {
    if (![s isKindOfClass:[NSString class]]) {
        return @"";
    }
    return [s stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
}

static BOOL BaseHasVersionSuffix(NSString *base) {
    NSArray *parts = [base componentsSeparatedByString:@"/"];
    for (NSInteger i = (NSInteger)parts.count - 1; i >= 0; i--) {
        NSString *p = parts[i];
        if (p.length == 0) {
            continue;
        }
        if ([p hasPrefix:@"v"] && p.length >= 2 && p.length <= 10) {
            NSString *rest = [p substringFromIndex:1];
            NSString *digits = [rest stringByTrimmingCharactersInSet:[NSCharacterSet decimalDigitCharacterSet]];
            if (digits.length == 0 || [rest hasPrefix:@"beta"]) {
                return YES;
            }
        }
        return NO;
    }
    return NO;
}

static NSArray *CandidateURLs(NSString *base, NSString *suffix) {
    NSMutableArray *candidates = [NSMutableArray array];
    NSString *trimmed = Trimmed(base);
    if (trimmed.length == 0) {
        trimmed = @"https://api.deepseek.com/v1";
    }
    while ([trimmed hasSuffix:@"/"]) {
        trimmed = [trimmed substringToIndex:trimmed.length - 1];
    }
    NSString *first = [trimmed stringByAppendingString:suffix];
    [candidates addObject:first];
    if (![suffix hasPrefix:@"/v1"] && !BaseHasVersionSuffix(trimmed)) {
        NSString *second = [[trimmed stringByAppendingString:@"/v1"] stringByAppendingString:suffix];
        if (![candidates containsObject:second]) {
            [candidates addObject:second];
        }
    }
    return candidates;
}

static id ConvertScalarValue(NSString *value) {
    if (![value isKindOfClass:[NSString class]]) {
        return nil;
    }
    NSString *trim = Trimmed(value);
    if (trim.length == 0) {
        return nil;
    }
    NSString *lower = [trim lowercaseString];
    if ([lower isEqualToString:@"true"]) {
        return @YES;
    }
    if ([lower isEqualToString:@"false"]) {
        return @NO;
    }
    if ([lower isEqualToString:@"null"] || [lower isEqualToString:@"none"]) {
        return nil;
    }
    NSScanner *scanner = [NSScanner scannerWithString:trim];
    double number = 0;
    if ([scanner scanDouble:&number] && scanner.isAtEnd) {
        return @(number);
    }
    return trim;
}

static NSString *ErrorTextFromBody(NSData *body, NSInteger statusCode) {
    if (body.length == 0) {
        return [NSString stringWithFormat:@"请求失败（HTTP %ld）", (long)statusCode];
    }
    id obj = [NSJSONSerialization JSONObjectWithData:body options:0 error:NULL];
    if ([obj isKindOfClass:[NSDictionary class]]) {
        id err = obj[@"error"];
        if ([err isKindOfClass:[NSDictionary class]] && [err[@"message"] isKindOfClass:[NSString class]]) {
            return err[@"message"];
        }
        if ([err isKindOfClass:[NSString class]]) {
            return err;
        }
        if ([obj[@"message"] isKindOfClass:[NSString class]]) {
            return obj[@"message"];
        }
        if ([obj[@"msg"] isKindOfClass:[NSString class]]) {
            return obj[@"msg"];
        }
    }
    NSString *text = [[NSString alloc] initWithData:body encoding:NSUTF8StringEncoding];
    if (!text) {
        text = [[NSString alloc] initWithData:body encoding:NSISOLatin1StringEncoding];
    }
    if (text.length > 300) {
        text = [text substringToIndex:300];
    }
    return [NSString stringWithFormat:@"请求失败（HTTP %ld）：%@", (long)statusCode, text ?: @""];
}

#pragma mark - Service

@interface AIService () <NSURLSessionDataDelegate>

@property (nonatomic, strong) NSURLSession *session;
@property (nonatomic, strong) NSOperationQueue *delegateQueue;
@property (nonatomic, strong) NSMutableDictionary *states; /* @(taskIdentifier) -> AIStreamState */

@end

@implementation AIService

- (instancetype)init {
    self = [super init];
    if (self) {
        _delegateQueue = [[NSOperationQueue alloc] init];
        _delegateQueue.maxConcurrentOperationCount = 1;
        _delegateQueue.name = @"ChatAI.AIService.delegate";

        NSURLSessionConfiguration *cfg = [NSURLSessionConfiguration defaultSessionConfiguration];
        cfg.timeoutIntervalForRequest = 300;
        cfg.timeoutIntervalForResource = 900;
        cfg.HTTPShouldUsePipelining = NO;
        cfg.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
        _session = [NSURLSession sessionWithConfiguration:cfg delegate:self delegateQueue:_delegateQueue];
        _states = [NSMutableDictionary dictionary];

        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleMemoryWarning:)
                                                     name:UIApplicationDidReceiveMemoryWarningNotification
                                                   object:nil];
    }
    return self;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [_session invalidateAndCancel];
}

- (void)handleMemoryWarning:(NSNotification *)note {
    [self.session flushWithCompletionHandler:^{}];
}

- (BOOL)hasRequest:(NSString *)requestId {
    for (AIStreamState *state in self.states.allValues) {
        if ([state.requestId isEqualToString:requestId] && !state.finished) {
            return YES;
        }
    }
    return NO;
}

#pragma mark - Models

- (void)fetchModelsWithConfig:(NSDictionary *)config
                   completion:(void (^)(NSArray *models, id raw, NSString *errorMessage))completion {
    NSString *base = [ChatConfig normalizedBaseURL:config];
    NSArray *candidates = CandidateURLs(base, @"/models");
    NSString *key = [ChatConfig apiKeyFromConfig:config];

    __block NSUInteger index = 0;
    __weak typeof(self) weakSelf = self;

    void (^tryNext)(NSInteger lastStatus) = ^(NSInteger lastStatus) {
        __strong typeof(weakSelf) self_ = weakSelf;
        if (!self_ || index >= candidates.count) {
            NSString *msg = lastStatus > 0
                ? [NSString stringWithFormat:@"获取模型失败（HTTP %ld）", (long)lastStatus]
                : @"获取模型失败，请检查 API 地址";
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(nil, nil, msg);
            });
            return;
        }
        NSString *urlString = candidates[index];
        index += 1;
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:urlString]];
        request.HTTPMethod = @"GET";
        request.timeoutInterval = 30;
        [request setValue:[@"Bearer " stringByAppendingString:key] forHTTPHeaderField:@"Authorization"];
        [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
        NSURLSessionDataTask *task = [self.session dataTaskWithRequest:request
                                                    completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            if (error) {
                tryNext(0);
                return;
            }
            NSInteger status = 0;
            if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
                status = [(NSHTTPURLResponse *)response statusCode];
            }
            if (status == 404 || status == 405) {
                tryNext(status);
                return;
            }
            if (status < 200 || status >= 300) {
                NSString *msg = ErrorTextFromBody(data, status);
                dispatch_async(dispatch_get_main_queue(), ^{
                    completion(nil, nil, msg);
                });
                return;
            }
            id obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
            NSMutableArray *ids = [NSMutableArray array];
            id list = nil;
            if ([obj isKindOfClass:[NSDictionary class]]) {
                list = obj[@"data"];
                if (![list isKindOfClass:[NSArray class]]) {
                    list = obj[@"models"];
                }
            } else if ([obj isKindOfClass:[NSArray class]]) {
                list = obj;
            }
            if ([list isKindOfClass:[NSArray class]]) {
                for (id item in list) {
                    if ([item isKindOfClass:[NSString class]]) {
                        [ids addObject:item];
                    } else if ([item isKindOfClass:[NSDictionary class]]) {
                        NSString *mid = item[@"id"];
                        if (![mid isKindOfClass:[NSString class]]) {
                            mid = item[@"name"];
                        }
                        if ([mid isKindOfClass:[NSString class]] && mid.length) {
                            [ids addObject:mid];
                        }
                    }
                }
            }
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(ids, obj, nil);
            });
        }];
        [task resume];
    };

    tryNext(0);
}

#pragma mark - Chat

- (NSString *)startChatWithConfig:(NSDictionary *)config
                        requestId:(NSString *)requestId
                         messages:(NSArray *)messages
                            image:(NSDictionary *)image
                         thinking:(NSDictionary *)thinking
                          onDelta:(AIDeltaBlock)onDelta
                      onReasoning:(AIDeltaBlock)onReasoning
                           onDone:(AIDoneBlock)onDone
                          onError:(AIErrorBlock)onError {
    NSString *base = [ChatConfig normalizedBaseURL:config];
    NSArray *candidates = CandidateURLs(base, @"/chat/completions");
    NSString *urlString = candidates.firstObject;
    NSString *key = [ChatConfig apiKeyFromConfig:config];
    NSString *model = [ChatConfig modelFromConfig:config];

    NSURL *url = [NSURL URLWithString:urlString];
    if (!url) {
        if (onError) {
            dispatch_async(dispatch_get_main_queue(), ^{
                onError(@"API 地址无效，请检查设置", -1);
            });
        }
        return requestId;
    }

    NSMutableArray *chatMessages = [NSMutableArray array];
    for (id item in messages) {
        if (![item isKindOfClass:[NSDictionary class]]) {
            continue;
        }
        NSString *role = item[@"role"];
        if (![role isKindOfClass:[NSString class]] || role.length == 0) {
            role = @"user";
        }
        id content = item[@"content"];
        if (![content isKindOfClass:[NSString class]]) {
            content = @"";
        }
        [chatMessages addObject:[@{ @"role": role, @"content": content } mutableCopy]];
    }

    if ([image isKindOfClass:[NSDictionary class]] && [image[@"dataBase64"] isKindOfClass:[NSString class]]) {
        NSString *b64 = image[@"dataBase64"];
        NSString *mime = image[@"mime"];
        if (![mime isKindOfClass:[NSString class]] || mime.length == 0) {
            mime = @"image/jpeg";
        }
        NSInteger lastUser = -1;
        for (NSInteger i = (NSInteger)chatMessages.count - 1; i >= 0; i--) {
            if ([chatMessages[(NSUInteger)i][@"role"] isEqualToString:@"user"]) {
                lastUser = i;
                break;
            }
        }
        if (lastUser >= 0 && b64.length > 0) {
            NSString *dataURL = [NSString stringWithFormat:@"data:%@;base64,%@", mime, b64];
            NSString *text = chatMessages[(NSUInteger)lastUser][@"content"];
            NSArray *parts = @[
                @{ @"type": @"text", @"text": (text.length ? text : @"") },
                @{ @"type": @"image_url", @"image_url": @{ @"url": dataURL } }
            ];
            chatMessages[(NSUInteger)lastUser] = [@{ @"role": @"user", @"content": parts } mutableCopy];
        }
    }

    NSMutableDictionary *body = [NSMutableDictionary dictionary];
    body[@"model"] = model.length ? model : @"gpt-4o-mini";
    body[@"messages"] = chatMessages;
    body[@"stream"] = @YES;

    if ([thinking isKindOfClass:[NSDictionary class]] && [thinking[@"enabled"] boolValue]) {
        NSString *param = thinking[@"param"];
        if (![param isKindOfClass:[NSString class]] || param.length == 0) {
            param = @"reasoning_effort";
        }
        id value = ConvertScalarValue(thinking[@"onValue"]);
        if (value) {
            body[param] = value;
        }
    }

    NSError *jsonError = nil;
    NSData *bodyData = [NSJSONSerialization dataWithJSONObject:body options:0 error:&jsonError];
    if (!bodyData) {
        if (onError) {
            dispatch_async(dispatch_get_main_queue(), ^{
                onError([NSString stringWithFormat:@"请求构造失败：%@", jsonError.localizedDescription], -2);
            });
        }
        return requestId;
    }

    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    request.timeoutInterval = 300;
    request.HTTPBody = bodyData;
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    [request setValue:@"text/event-stream" forHTTPHeaderField:@"Accept"];
    [request setValue:@"identity" forHTTPHeaderField:@"Accept-Encoding"];
    if (key.length) {
        [request setValue:[@"Bearer " stringByAppendingString:key] forHTTPHeaderField:@"Authorization"];
    }
    [request setValue:@"ChatAI/1.0 (iPad; iOS)" forHTTPHeaderField:@"User-Agent"];

    AIStreamState *state = [[AIStreamState alloc] init];
    state.requestId = requestId;
    state.lineBuffer = [NSMutableData data];
    state.pendingText = [NSMutableString string];
    state.pendingReasoning = [NSMutableString string];
    state.body = [NSMutableData data];
    state.onDelta = onDelta;
    state.onReasoning = onReasoning;
    state.onDone = onDone;
    state.onError = onError;

    NSURLSessionDataTask *task = [self.session dataTaskWithRequest:request];
    state.task = task;
    self.states[@(task.taskIdentifier)] = state;
    NSLog(@"[ChatAI] chat start %@ -> %@ (model=%@)", requestId, urlString, model);
    [task resume];
    return requestId;
}

- (void)stopRequest:(NSString *)requestId {
    for (NSNumber *key in self.states.allKeys) {
        AIStreamState *state = self.states[key];
        if ([state.requestId isEqualToString:requestId] && !state.finished) {
            state.stopped = YES;
            [state.task cancel];
            [self.states removeObjectForKey:key];
            NSLog(@"[ChatAI] chat stop %@", requestId);
            return;
        }
    }
}

#pragma mark - State helpers

- (AIStreamState *)stateForTask:(NSURLSessionTask *)task {
    return self.states[@(task.taskIdentifier)];
}

- (void)removeStateForTask:(NSURLSessionTask *)task {
    AIStreamState *state = [self stateForTask:task];
    if (state) {
        [self.states removeObjectForKey:@(task.taskIdentifier)];
    }
}

- (void)flushState:(AIStreamState *)state {
    if (state.pendingText.length > 0) {
        NSString *text = [state.pendingText copy];
        [state.pendingText setString:@""];
        if (state.onDelta) {
            state.onDelta(text);
        }
    }
    if (state.pendingReasoning.length > 0) {
        NSString *text = [state.pendingReasoning copy];
        [state.pendingReasoning setString:@""];
        if (state.onReasoning) {
            state.onReasoning(text);
        }
    }
}

- (void)scheduleFlush:(AIStreamState *)state {
    if (state.flushScheduled || state.finished) {
        return;
    }
    state.flushScheduled = YES;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.03 * NSEC_PER_SEC)), self.delegateQueue, ^{
        state.flushScheduled = NO;
        [weakSelf flushState:state];
    });
}

- (void)finishState:(AIStreamState *)state {
    if (state.finished) {
        return;
    }
    state.finished = YES;
    [self flushState:state];
    NSDictionary *usage = state.usage;
    AIDoneBlock done = state.onDone;
    if (done) {
        done(usage);
    }
}

- (void)failState:(AIStreamState *)state message:(NSString *)message code:(NSInteger)code {
    if (state.finished) {
        return;
    }
    state.finished = YES;
    [self flushState:state];
    AIErrorBlock block = state.onError;
    if (block) {
        block(message ? message : @"未知错误", code);
    }
}

#pragma mark - SSE

- (void)extractDeltaFromObject:(NSDictionary *)obj state:(AIStreamState *)state {
    id error = obj[@"error"];
    if ([error isKindOfClass:[NSDictionary class]] || [error isKindOfClass:[NSString class]]) {
        NSString *msg = nil;
        if ([error isKindOfClass:[NSDictionary class]] && [error[@"message"] isKindOfClass:[NSString class]]) {
            msg = error[@"message"];
        } else if ([error isKindOfClass:[NSString class]]) {
            msg = error;
        }
        [self failState:state message:(msg.length ? msg : @"模型返回错误") code:-3];
        return;
    }

    id usage = obj[@"usage"];
    if ([usage isKindOfClass:[NSDictionary class]]) {
        state.usage = usage;
    }

    id choices = obj[@"choices"];
    if (![choices isKindOfClass:[NSArray class]] || [choices count] == 0) {
        return;
    }
    NSDictionary *choice = choices[0];
    if (![choice isKindOfClass:[NSDictionary class]]) {
        return;
    }
    NSDictionary *delta = choice[@"delta"];
    if (![delta isKindOfClass:[NSDictionary class]]) {
        delta = choice[@"message"];
    }
    if ([delta isKindOfClass:[NSDictionary class]]) {
        id content = delta[@"content"];
        if ([content isKindOfClass:[NSString class]] && [content length] > 0) {
            if ([delta[@"role"] isKindOfClass:[NSString class]]) {
                // ignore role-only chunks
            }
            [state.pendingText appendString:content];
            [self scheduleFlush:state];
        }
        id reasoning = delta[@"reasoning_content"];
        if (![reasoning isKindOfClass:[NSString class]]) {
            reasoning = delta[@"reasoning"];
        }
        if ([reasoning isKindOfClass:[NSString class]] && [reasoning length] > 0) {
            [state.pendingReasoning appendString:reasoning];
            [self scheduleFlush:state];
        }
    }
    id finish = choice[@"finish_reason"];
    if ([finish isKindOfClass:[NSString class]] && [finish length] > 0 && ![finish isEqualToString:@"null"]) {
        // wait for [DONE] or stream end; nothing to do here
    }
}

- (void)handleLine:(NSString *)line state:(AIStreamState *)state {
    if (![line isKindOfClass:[NSString class]]) {
        return;
    }
    if ([line hasSuffix:@"\r"]) {
        line = [line substringToIndex:line.length - 1];
    }
    if (line.length == 0) {
        return;
    }
    if ([line hasPrefix:@"data:"]) {
        NSString *payload = [line substringFromIndex:5];
        payload = [payload stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        if ([payload isEqualToString:@"[DONE]"]) {
            [self finishState:state];
            return;
        }
        if (payload.length == 0) {
            return;
        }
        NSError *err = nil;
        id obj = [NSJSONSerialization JSONObjectWithData:[payload dataUsingEncoding:NSUTF8StringEncoding]
                                                 options:0
                                                   error:&err];
        if ([obj isKindOfClass:[NSDictionary class]]) {
            [self extractDeltaFromObject:obj state:state];
        } else if (err) {
            NSLog(@"[ChatAI] SSE JSON parse error: %@ payload=%@", err.localizedDescription, payload);
        }
        return;
    }
    if ([line hasPrefix:@"{"]) {
        id obj = [NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding]
                                                 options:0
                                                   error:NULL];
        if ([obj isKindOfClass:[NSDictionary class]]) {
            [self extractDeltaFromObject:obj state:state];
        }
    }
}

- (void)consumeBuffer:(AIStreamState *)state {
    NSData *newline = [@"\n" dataUsingEncoding:NSUTF8StringEncoding];
    while (YES) {
        NSRange range = [state.lineBuffer rangeOfData:newline options:0 range:NSMakeRange(0, state.lineBuffer.length)];
        if (range.location == NSNotFound) {
            break;
        }
        NSData *lineData = [state.lineBuffer subdataWithRange:NSMakeRange(0, range.location)];
        [state.lineBuffer replaceBytesInRange:NSMakeRange(0, NSMaxRange(range)) withBytes:NULL length:0];
        NSString *line = [[NSString alloc] initWithData:lineData encoding:NSUTF8StringEncoding];
        if (!line) {
            line = [[NSString alloc] initWithData:lineData encoding:NSISOLatin1StringEncoding];
        }
        [self handleLine:line state:state];
        if (state.finished) {
            return;
        }
    }
}

#pragma mark - NSURLSessionDataDelegate

- (void)URLSession:(NSURLSession *)session
              dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveResponse:(NSURLResponse *)response
     completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
    AIStreamState *state = [self stateForTask:dataTask];
    if (state) {
        if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
            state.statusCode = http.statusCode;
            NSString *contentType = http.allHeaderFields[@"Content-Type"];
            if (![contentType isKindOfClass:[NSString class]]) {
                contentType = @"";
            }
            state.isEventStream = [contentType rangeOfString:@"text/event-stream"].location != NSNotFound;
            NSLog(@"[ChatAI] response status=%ld type=%@", (long)state.statusCode, contentType);
        }
    }
    completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data {
    AIStreamState *state = [self stateForTask:dataTask];
    if (!state || state.finished) {
        return;
    }
    if (state.statusCode >= 400) {
        [state.body appendData:data];
        return;
    }
    if (state.isEventStream) {
        [state.lineBuffer appendData:data];
        [self consumeBuffer:state];
    } else {
        [state.body appendData:data];
    }
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didCompleteWithError:(NSError *)error {
    AIStreamState *state = [self stateForTask:task];
    if (!state) {
        return;
    }
    if (state.finished) {
        [self removeStateForTask:task];
        return;
    }
    if (state.stopped) {
        [self removeStateForTask:task];
        return;
    }
    if (error) {
        if (error.code == NSURLErrorCancelled) {
            [self removeStateForTask:task];
            return;
        }
        [self failState:state message:error.localizedDescription code:error.code];
        [self removeStateForTask:task];
        return;
    }
    if (state.statusCode >= 400) {
        NSString *message = ErrorTextFromBody(state.body, state.statusCode);
        [self failState:state message:message code:state.statusCode];
        [self removeStateForTask:task];
        return;
    }
    if (state.isEventStream) {
        if (state.lineBuffer.length > 0) {
            NSString *tail = [[NSString alloc] initWithData:state.lineBuffer encoding:NSUTF8StringEncoding];
            [self handleLine:tail state:state];
        }
        [self finishState:state];
    } else {
        NSError *jsonError = nil;
        id obj = nil;
        if (state.body.length > 0) {
            obj = [NSJSONSerialization JSONObjectWithData:state.body options:0 error:&jsonError];
        }
        if ([obj isKindOfClass:[NSDictionary class]]) {
            id usage = obj[@"usage"];
            if ([usage isKindOfClass:[NSDictionary class]]) {
                state.usage = usage;
            }
            id choices = obj[@"choices"];
            if ([choices isKindOfClass:[NSArray class]] && [choices count] > 0) {
                NSDictionary *choice = choices[0];
                NSDictionary *msg = choice[@"message"];
                if (![msg isKindOfClass:[NSDictionary class]]) {
                    msg = choice[@"delta"];
                }
                id content = msg[@"content"];
                if ([content isKindOfClass:[NSString class]] && [content length]) {
                    [state.pendingText appendString:content];
                }
            }
            [self finishState:state];
        } else {
            NSString *message = jsonError
                ? [NSString stringWithFormat:@"响应解析失败：%@", jsonError.localizedDescription]
                : @"响应为空";
            [self failState:state message:message code:-4];
        }
    }
    [self removeStateForTask:task];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge
 completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))completionHandler {
    completionHandler(NSURLSessionAuthChallengePerformDefaultHandling, nil);
}

@end
