TARGET = iphone:clang:10.3:8.0
ARCHS = armv7
INSTALL_TARGET_PROCESSES = ChatAI

include $(THEOS)/makefiles/common.mk

APPLICATION_NAME = ChatAI
ChatAI_FILES = $(wildcard ChatAI/*.m)
ChatAI_FRAMEWORKS = UIKit Foundation WebKit CoreGraphics QuartzCore
ChatAI_CFLAGS = -fobjc-arc -fblocks
ChatAI_RESOURCE_DIRS = Resources

include $(THEOS_MAKE_PATH)/application.mk
