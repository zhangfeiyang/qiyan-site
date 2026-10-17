---
title: 棋眼 iOS 版隐私政策
---

# 棋眼(QiYan) iOS 版隐私政策

最后更新：2026 年 10 月 17 日

本政策只适用于 App Store 上的**棋眼 iOS 版**（bundle id `com.zhangfeiyang.qiyan`）。
安卓版另有[单独的政策](privacy-policy.html)——两者的区别是：iOS 版**没有** AI 分析 / AI 对话功能，
因此完全不联网。

## 一句话概括

棋眼 iOS 版**不收集任何数据**：没有账号、没有服务器、没有统计或广告 SDK，所有功能都在你的
iPhone 上本地运行，应用本身不发起任何网络请求。

## 各项功能如何处理数据

### 相机（拍照识局 / 实时支招）

- 用途：识别棋盘上的棋子摆放。
- 识别由打包在应用内的神经网络模型在**本机**完成。照片和摄像头画面**不会上传**，
  不会被保存到相册，也不会写入应用存储；实时支招的画面只在内存里逐帧处理，用完即弃。
- 可以随时在「设置 → 棋眼」里关闭相机权限；关闭后这两项功能不可用，其余功能不受影响。

### 相册（从相册选图识局）

- 使用系统的照片选择器：应用只能拿到你**亲手选中的那一张**图片，无法浏览你的相册。
- 选中的图片只在本机用于识别，不上传、不保存。

### 麦克风与语音识别（语音走子）

- 用途：把你说的着法（如"炮二平五"）转成走子。只在你按下麦克风按钮后才开始录音。
- 在支持离线识别的设备上，语音识别**完全在本机完成**；不支持离线识别的设备上，
  这段语音由 **Apple 的语音识别服务**处理，受 [Apple 隐私政策](https://www.apple.com/legal/privacy/)
  约束，开发者收不到也存不下这段语音。
- 不用语音走子就不会请求麦克风权限。

### 对局记录、积分与设置

- 只保存在你手机上本应用的私有存储里，不上传。
- 删除应用即全部删除；也可以在应用的「设置 → 清除所有数据」里随时清空。
- 如果你开启了 iPhone 的 iCloud 备份或电脑备份，这些本地数据会随系统备份一起保存，
  这由你的系统设置决定，开发者无法访问。

## 我们不收集的

无账号、无姓名/邮箱/电话、无位置、无通讯录、无广告标识符（IDFA）、无设备指纹、
无使用行为统计、无崩溃上报。应用不包含任何第三方统计、广告或崩溃上报 SDK，
也不做跨应用跟踪。

## 权限清单

| 权限 | 何时请求 | 用途 |
|---|---|---|
| 相机 | 首次使用拍照识局/实时支招 | 本机识别棋盘，不上传 |
| 麦克风 | 首次使用语音走子 | 录下你说的着法 |
| 语音识别 | 首次使用语音走子 | 把语音转成着法文字 |

## 儿童

本应用适合所有年龄，不收集任何人的个人信息，包括儿童。

## 变更

政策有实质变更时，会更新本页顶部的日期，并在应用更新说明中注明。

## 联系方式

对本政策有疑问，请在 <https://github.com/zhangfeiyang/qiyan-site/issues> 提交 issue。

---

# QiYan for iOS — Privacy Policy

Last updated: October 17, 2026

This policy covers **QiYan for iOS** on the App Store (bundle id `com.zhangfeiyang.qiyan`).
Unlike the Android version, the iOS version has **no AI analysis / AI chat feature** and does not use the network.

**In short: QiYan for iOS collects no data.** There are no accounts, no servers, and no analytics, advertising
or crash-reporting SDKs. Everything runs locally on your iPhone and the app itself makes no network requests.

- **Camera (photo recognition / live advice):** pieces are recognized on the device by a model bundled with
  the app. Photos and camera frames are never uploaded, saved to your library or stored by the app; live frames
  are processed in memory and discarded.
- **Photos:** the system photo picker gives the app only the single image you choose; it is used on the device
  for recognition and not uploaded or stored.
- **Microphone & speech recognition (voice moves):** recording starts only when you tap the microphone.
  On devices that support it, recognition happens entirely on the device; otherwise the audio is processed by
  Apple's speech recognition service under [Apple's Privacy Policy](https://www.apple.com/legal/privacy/).
  The developer never receives it.
- **Games, rating and settings** stay in the app's private storage on your phone. Deleting the app, or
  Settings → Clear All Data, removes them. They may be included in your iCloud or computer backups, according to
  your system settings; the developer cannot access them.
- **Not collected:** account details, name, email, phone, location, contacts, advertising identifier, device
  fingerprint, usage analytics, crash reports. No tracking across apps.
- **Children:** suitable for all ages; no personal information is collected from anyone.
- **Changes** are dated at the top of this page and mentioned in the release notes.
- **Contact:** open an issue at <https://github.com/zhangfeiyang/qiyan-site/issues>.
