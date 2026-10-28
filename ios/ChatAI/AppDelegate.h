#import <UIKit/UIKit.h>

@interface AppDelegate : UIResponder <UIApplicationDelegate>

/* Restricts rotation while a modal controller is presented. */
+ (void)lockOrientation:(UIInterfaceOrientationMask)mask;
+ (void)unlockOrientation;

@property (nonatomic, strong) UIWindow *window;

@end
