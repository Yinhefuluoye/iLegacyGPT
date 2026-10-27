TARGET = iphone:clang:10.3:9.3
# armv7 covers the 32-bit devices (iPad 4, iPhone 5/5c) and arm64 the early
# 64-bit ones (iPhone 5s … X) that still run iOS 9/10.
ARCHS = armv7 arm64
INSTALL_TARGET_PROCESSES = ChatAI

include $(THEOS)/makefiles/common.mk

APPLICATION_NAME = ChatAI
ChatAI_FILES = $(wildcard ChatAI/*.m)
ChatAI_FRAMEWORKS = UIKit Foundation WebKit CoreGraphics QuartzCore
ChatAI_CFLAGS = -fobjc-arc -fblocks
# armv7 exception handling on this toolchain uses the SjLj runtime. The SDK's
# libgcc_s.1 stub carries only armv7/armv7s slices, so link it for armv7 only.
armv7_LDFLAGS = -lgcc_s.1
ChatAI_RESOURCE_DIRS = Resources

include $(THEOS_MAKE_PATH)/application.mk
