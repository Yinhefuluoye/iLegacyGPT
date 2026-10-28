#import "AppDelegate.h"
#import "WebViewController.h"

static UIInterfaceOrientationMask gOrientationLock = 0;

@implementation AppDelegate

+ (void)lockOrientation:(UIInterfaceOrientationMask)mask {
    gOrientationLock = mask;
}

+ (void)unlockOrientation {
    gOrientationLock = 0;
}

- (UIInterfaceOrientationMask)application:(UIApplication *)application
    supportedInterfaceOrientationsForWindow:(UIWindow *)window {
    if (gOrientationLock != 0) {
        return gOrientationLock;
    }
    return UIInterfaceOrientationMaskAll;
}

- (BOOL)application:(UIApplication *)application
        didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    self.window = [[UIWindow alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
    self.window.rootViewController = [[WebViewController alloc] init];
    [self.window makeKeyAndVisible];
    return YES;
}

@end
