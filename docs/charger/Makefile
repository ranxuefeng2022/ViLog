# hm 框架父目录的构建入口.
# 挪进内核树时, 在上一级 Makefile (如 drivers/hm/Makefile) 追加:
#   obj-y += charger/		# 或真实目录名
# hm-common 在前: 它是下方模块链接的支持库(内建对象不讲究链接
# 顺序, 但库在前是惯例)

# hm-common 的 include 路径在此统一提供一次. 必须是
# subdir-ccflags-y: 普通 ccflags-y 只作用于本 Makefile 编译的对象
# (本文件只下钻不编译), 且不会传导进子目录
subdir-ccflags-y += -I$(srctree)/$(src)/hm-common

obj-y += hm-common/
obj-$(CONFIG_HM_CHARGER) += hm-charger/
obj-$(CONFIG_HM_BATTERY) += hm-battery/
