#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

@interface WebViewController : UIViewController <WKScriptMessageHandler>

@property (nonatomic, strong) WKWebView *webView;

@end
