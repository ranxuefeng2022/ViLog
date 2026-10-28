# hm 充电框架(docs/charger)

内核充电框架参考实现。**只写不编**:本机(macOS)无内核树,clangd 报
`linux/*.h not found` 属预期。所有代码注释为英文;讨论用中文。

新会话从这里开始。架构理由大多写在代码内的关键位置(文件头注释、
决策点上方),改动前先读对应注释。

## 目录

```
charger/
├── README.md            本文档
├── Makefile / Kconfig   父目录 glue(subdir-ccflags-y 统一提供
│                        hm-common 的 include 路径,子模块不再自加)
├── hm-common/           共享库: voter.c/h(投票仲裁) hm_event.c/h(事件总线)
│                        hm_power_supply.h(私有 psy 协议) hm_log.h(日志宏)
├── hm-charger/          充电信息中枢: usb psy + 检测管线 + votables
└── hm-battery/          电池 psy "battery": status/health/JEITA/保护
                         (FG 钩子内嵌; hm-fg 形态决策仍悬置)
```

接入内核树:父目录 Makefile 加 `obj-y += charger/`,Kconfig source 两行,
drivers/Kconfig 追加 source。ccflags -I hm-common 已配好。

## 架构(hm_charger.c 文件头有完整图)

- **一个 psy**:"usb" 同时服务两个受众——标准属性(6 个,对用户空间)
  和内核协议(自定义属性,**不进 desc->properties 故不上 sysfs**,仅
  hm 模块经 HM_PSY_GET/SET_PROP 到达)。协议 case 与标准 case 混在
  同一个 switch,用 `/* kernel-only */` 注释行分界(曾试过拆成独立
  proto handler 函数,已回退——基线是混排版)。混有 HM_ case 的
  switch 控制表达式一律 `(int)` 强转(否则 -Wswitch 告警)。
  hm-battery 读输入状态用标准 `POWER_SUPPLY_PROP_ONLINE`(私有
  USB_ONLINE 已删:合并后冗余)
- **检测管线**(det_work):BC12 → 5V 功率扫描 → QC 探测 → QC 扫描,
  永不被 PD 打扰;**PD 监听**(pd_event)独立记账
- **仲裁**(chg_arbitrate):证据的纯函数分类(PD>QC>BC1.2),幂等,
  结论变了才发布 HM_EVT_PWR_CHG_TYPE_CHANGED
- **协议选择**(chg_protocol_select):策略层经 usb psy 的
  PROTOCOL_SELECT 属性(内核专用)点菜,菜单未发布(DET_DONE 前)返回 -EAGAIN
- **七个 votable**:icl/ichg/fv/iterm/vindpm(MIN/MAX 仲裁) +
  chg_disable(电池侧关断,SET_ANY) + chg_suspend(输入暂停,SET_ANY)。
  vote 即下发(回调写主充 psy);hm_vote() 宏带调用点归属日志
- **VBUS 防抖**:原始采样 usb_raw + 确认窗口(在线 100ms/离线 500ms),
  glitch 吸收;离线窗口兼任功率检测的"营救窗口"(settle<窗口)

## 已定型(勿轻易重构)

- 单位一律 mA/mV;psy ABI 边界 ×1000/÷1000
- 防抖:usb_present(已确认)/usb_raw(物理采样)两态;不变量:
  usb_raw≠usb_present 时必有挂起窗口(见 chg_suspend 的重置注释)
- 功率扫描:粗进(200/500/1000/1500/2000)+二分(精度 100mA);
  completion 事件驱动掉线唤醒;vindpm 布防= vbat+300mV,撤防是纯账面
  (硬件残留门限继续保护,runtime 维护归策略层,规则 max(4400,vbat+300))
- probe 顺序规则:mutex→votables→works→psys→事件订阅(入口最后开放)
- 拔出竞态:det_work 顶部/DET_PWR case/complete 入口三道闸都查
  usb_present;det_stop 的 cancel_sync 是汇合点,清理永远是最后动作
- voter.c 相对 qcom upstream 的改动清单见其文件头(去 debugfs、
  id 变化也触发回调、查询无注册副作用、三个 bug fix)

## 移植清单(挂到真硬件要做的事)

hooks(hm_charger.c 内搜 TODO):
1. chg_vbus_irq_cb: 真实 VBUS 检测(现在 raw 硬编码 false!)
2. chg_bc12_start/poll: 主充 IC 的 BC1.2
3. chg_hvdcp_probe_start/poll: QC 探测(D+/D- 摆压看 VBUS 升)
4. chg_pwr_vindpm_hit: 读主充折返状态(注意:VINDPM_TRIGGERED
   属性已从协议头删除,需恢复或改走主充其它状态口)
5. chg_pwr_qc_enter: QC 握手升压
6. chg_protocol_apply: PD Request / QC 档位 / 5V 回落
   (QC 扫描后适配器停在 9V,5V 档必须命令降回)
协议:主充模块("primary_chg_psy")需实现 INPUT_CURRENT_MA /
CHARGE_CURRENT_MA / CHARGE_VOLTAGE_MV / ITERM_MA / VINDPM_MV /
CHARGING_ENABLED / INPUT_SUSPEND;tcpc notifier → chg_pd_event
(含 capable=false 表合同丢失)
策略层(cms):PROTOCOL_SELECT 点菜 + runtime vindpm 维护

## 已知缺口/待办(按优先级)

1. **测量数据无来源**:vbus_mv/ibus_ma/input_ilim_ma 没有写入者
   (poll work 已删)。建议 get_prop 拉模型:现读主充 psy
2. **Type-C Rp 电流档未接入**:非 PD 的 Type-C 头(1.5A/3A)会被
   降级分类。tcpc 事件加 Rp 档 → classify 加 TYPE_C → cap 用 Rp 值
3. HM_EVT_PWR_UPDATE 已无发布者(死事件,清理或复用)
4. MODULE_DESCRIPTION 还写着 "poll work"(已删)
5. secondery_chg_psy 未用(双充预留,拼写应为 secondary)
6. QC3 细分(qc3_capable 标志,策略层精细调压用)
7. 私有协议(VOOC/SCP/AFC/FlashCharge):照 HVDCP 模式逐个加
