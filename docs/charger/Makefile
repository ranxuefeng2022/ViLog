# Build entry of the hm framework parent directory.
# When moving this tree into a kernel tree, append to the Makefile one
# level up (e.g. drivers/hm/Makefile):
#   obj-y += charger/		# or the real directory name
# hm-common comes first: it is the support library linked by the
# modules below (link order does not matter for builtin objects, but
# libraries first is the convention)

# hm-common include path, provided ONCE here for every submodule below.
# Must be subdir-ccflags-y: plain ccflags-y only applies to objects
# compiled by THIS Makefile (none -- it only descends) and does not
# propagate into the subdirectories
subdir-ccflags-y += -I$(srctree)/$(src)/hm-common

obj-y += hm-common/
obj-$(CONFIG_HM_CHARGER) += hm-charger/
obj-$(CONFIG_HM_BATTERY) += hm-battery/
