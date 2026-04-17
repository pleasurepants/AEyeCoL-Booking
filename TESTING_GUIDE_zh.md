# 测试指南（中文）

本指南从**用户的视角**，在网页上走一遍新功能，不需要懂代码或数据库。
需要准备：

- **3 个能收信的邮箱**（或同一个邮箱加 `+` 别名，例如 `you@gmail.com`、`you+a@gmail.com`、`you+b@gmail.com`）。下面记作 **邮箱 A / B / C**。
- **admin 密码**（打开 `/admin` 时会弹窗要求输入）。
- 每步验证时都顺手去对应邮箱**收件箱 + 垃圾箱**看邮件是否送达。

建议**按顺序一项项测**，每测完一项再进下一项，避免互相干扰。

---

## 测试 1：订阅新 session 通知

**目的**：打开 `/subscribe` 页面能成功订阅并收到确认邮件。

1. 浏览器打开 `你的域名/subscribe`。
2. 填入 **邮箱 A** + 任意姓名，点 **Subscribe**。
3. ✅ 页面应变成绿色，标题 "You're subscribed"。
4. 打开邮箱 A，应收到一封 **"You're on the notification list"** 邮件，里面有一个 **Unsubscribe here** 的链接。

**重复测试（幂等性）**
1. 用同一个邮箱 A 再 Subscribe 一次。
2. ✅ 页面应显示 "You're already on the list"（说明系统知道你已经订阅过了，不会重复加）。

---

## 测试 2：退订功能

1. 打开测试 1 收到的那封订阅邮件，点 **Unsubscribe here**。
2. ✅ 浏览器跳到 `/unsubscribe`，页面显示 "You've been unsubscribed"。
3. 做完后再用邮箱 A 重新 Subscribe 一次（准备下一个测试）。

---

## 测试 3：管理员新建 session 时，订阅者收到通知

1. 用邮箱 A 订阅（确保测试 1 完成且没被退订）。
2. 另开一个标签页 → `/admin` → 输入密码 → 点 **Add Session** → 填一个未来日期 → 提交。
3. ✅ Session 在 admin 页面正常出现（这步如果失败说明有 bug）。
4. ✅ 打开邮箱 A，应收到一封 **"New Study Session Available — {日期}"** 邮件，里面有蓝色 **Book This Session** 按钮。
5. 点按钮应跳回首页。

---

## 测试 4：确认邮件列出其他备选

1. `/admin` → 建两个未来 session：
   - **S1**：Max Participants 设为 **1**
   - **S2**：Max Participants 设为 **4**
2. 前端首页用 **邮箱 B** 提交，First Choice 选 S1，不选 backup → 提交。
3. ✅ 邮箱 B 收到 "Session Confirmed"，S1 现在满了。
4. 前端首页用 **邮箱 A** 提交：
   - First Choice = S1（显示 Full — Waitlist Available）
   - Backup 1 = S2
   - 提交
5. ✅ 邮箱 A 收到 **"Confirmed — Backup Session"** 风格的 confirmation 邮件。
6. ✅ 邮件里 S2 详情下方有一块**灰色框** "Your other preference (kept on the waitlist)"，里面写着 "1st choice: {S1 日期} {S1 时间}"。

**反向检查**：如果只选一个 session 没有 backup 提交，confirmation 邮件里**不应该**出现这个灰色框。

---

## 测试 5：取消邮件含 Book Again 按钮

1. 用邮箱 A 提交并被确认到某 session（任何一个都行）。
2. 打开邮箱 A 的 confirmation 邮件，点红色 **Cancel Booking** 按钮。
3. ✅ 浏览器显示取消成功。
4. ✅ 邮箱 A 再收到一封 **"Booking Cancelled"** 邮件。
5. ✅ 邮件底部应有一个**蓝色按钮 "Book a New Session"**，点击回到首页。

---

## 测试 6：Admin 按钮改名（页面检查）

打开 `/admin`，输入密码进入。对照检查：

| 位置 | 应该看到的文字 |
|---|---|
| Confirmed 状态 booking 行的黄色按钮 | **Unconfirm** |
| 每一行末尾的红色文字按钮 | **Remove** |
| 点 Remove 后弹出的确认 | **Yes** / **No** |
| Session 头部右侧红色按钮 | **Remove** |
| 点 session 的 Remove 后弹出的确认 | **Yes, Remove** / **Keep** |

✅ 不应该再看到 "Pending"、"Delete"、"Yes, Delete"、"Cancel" 这几个旧标签。

---

## 测试 7：Admin 删除一个 confirmed 参与者 → 发取消邮件

1. 确保邮箱 A 处于 confirmed 状态（不行就重新提交一次）。
2. `/admin` 找到那行 → 点 **Remove** → **Yes**。
3. ✅ 邮箱 A 收到 **"Booking Cancelled"** 邮件（含 Book a New Session 按钮）。

**反向检查**：
1. 另一个邮箱 B 提交到某个满 session 的 **waitlist**（状态是 pending，琥珀色标签）。
2. Admin 把这个 pending 行 Remove 掉。
3. ✅ 邮箱 B **不应**收到取消邮件（waitlist 上的人被删不打扰）。

---

## 测试 8：Admin 取消 session 自动推 backup

### 场景 A：有 backup
1. 建 session S1（max 1）和 S2（max 4）。
2. 用邮箱 B 占掉 S1。
3. 用邮箱 A 提交：First = S1（满）、Backup 1 = S2 → 提交。此时 A 在 S1 是 pending（waitlist），在 S2 是 confirmed？**注意**：如果 A 第一次提交就只有 S1 是满的，逻辑会把 A 放到 S2 confirmed。为了造"A 在 S1 confirmed、S2 pending"的场景，换个顺序：
   - **先**用邮箱 A 提交：First = S1、Backup 1 = S2（此时 S1 还空，A 被 confirmed 进 S1，S2 保留为 pending 备选）。
4. Admin 进 `/admin`，找到 **S1**，把 status 下拉框从 `Upcoming` 改成 **Cancelled**。
5. ✅ 邮箱 A 收到 **"Session Cancelled"** 邮件，里面有**绿色方块** "You have been moved to your backup session"，写着 S2 的日期/时间。
6. ✅ 回到 `/admin`，刷新页面。A 现在应在 **S2** 的名单里，状态 confirmed。

### 场景 B：没有 backup
1. 新建一个 session S3。
2. 用邮箱 C 提交，只选 S3 不选 backup → C confirmed 到 S3。
3. Admin 把 S3 改成 Cancelled。
4. ✅ 邮箱 C 收到 **"Session Cancelled"** 邮件，里面是**琥珀色方块** "No backup session available" + 底部蓝色 **Book a New Session** 按钮。

---

## 测试 9：满场 session 用户被引导订阅

### 9.1 首页底部小提示
1. 首页填完个人信息，进入 "Select Your First Choice" 页。
2. ✅ 在 session 卡片**下方**应看到一条蓝色小字提示：
   > Don't see a time that works? **Get an email when new sessions open**.
3. 点链接应跳到 `/subscribe`（且 email 已预填）。

### 9.2 没有可用 session 时的提示
1. Admin 把所有未来 session 都 Remove 或改成 cancelled。
2. 刷新首页，走到 "Select Your First Choice"。
3. ✅ 应看到居中一行字 "No sessions available right now." + 一个蓝色大按钮 **Notify me when new sessions open**。

### 9.3 提交到 waitlist 后的引导
1. 把所有 session 都填满（多用几个邮箱抢占）。
2. 用新邮箱 **D** 提交，选满的 session 作为 first choice → 提交。
3. ✅ 结果页应是黄色 "On the Waitlist"。
4. ✅ 黄色框**下方**应有一张白色卡片 "Want to hear about brand-new sessions?" + 橙色按钮 **Notify me about new sessions**。
5. ✅ 邮箱 D 收到 "Session Availability Update" 邮件，里面包含蓝色 **Notify Me About New Sessions** 按钮。

---

## 测试 10：回归检查（快速点一遍老功能）

走一遍这些旧流程，确保没被新改动弄坏：

- [ ] 用全新邮箱正常提交预约 → 收到 "Session Confirmed" 邮件
- [ ] 用已经 confirmed 的邮箱再次提交 → 前端显示错误 "already has a confirmed registration"
- [ ] 从 confirmation 邮件点 Cancel 链接 → 取消成功 + 收到取消邮件
- [ ] `/admin` 里每行最后一列 **Other Prefs** 有显示其他偏好的日期
- [ ] `/admin` 里点某行的 **Email** 按钮 → 能弹出窗口发自定义邮件

---

## 故障排查（帮你判断哪里出问题）

| 现象 | 最可能的原因 |
|---|---|
| 订阅页提交后一直转圈或报错 | 服务端环境变量可能没配好，让开发者检查 Vercel 部署 |
| 订阅成功但收不到邮件 | 先翻**垃圾箱 / 促销 / 其他文件夹**；还没有就是邮件服务的问题 |
| Admin 建 session 后订阅者没收到通知 | 确认你确实已经订阅（可在 `/subscribe` 重新订阅确认，页面应显示 "already on the list"） |
| 点 Cancel 链接报 "Session already expired" | 这是正常的 — session 已经结束后不能再取消 |
| 两封邮件几乎同时到（场景 A 取消推 backup 时） | 正常 — 一封是"session 被取消 + 推到 backup"，一封是"backup 确认" |

---

测试完成后，如果某步的 ✅ 没出现，记下是哪一步、什么现象，反馈给开发者。
