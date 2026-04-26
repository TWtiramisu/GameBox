---
name: shadcn-ui
description: Use when adding UI components to Momiji Select frontend or dashboard. shadcn/ui is a collection of beautifully designed, accessible, customizable components built on Radix UI and Tailwind CSS.
---

# shadcn/ui 使用指引

shadcn/ui 是一套可複製貼上的 UI 元件集，不是傳統的 npm 套件。每個元件的程式碼直接放在你的專案中，完全可自訂。

## 核心概念
- **不是 npm 套件** — 元件程式碼直接複製到你的專案
- **基於 Radix UI** — 無障礙 (accessible) 的原始元件
- **基於 Tailwind CSS** — 樣式系統
- **完全可自訂** — 直接修改元件原始碼

## Momiji Select 使用方式

### 初始化（若尚未設定）
```bash
npx shadcn@latest init
```
回答提示：
- Style: Default
- Base color: Slate 或 Zinc（配合楓葉深色主題）
- CSS variables: Yes

### 安裝元件
```bash
# 安裝單一元件
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add table
npx shadcn@latest add dialog
npx shadcn@latest add form
npx shadcn@latest add input
npx shadcn@latest add select
npx shadcn@latest add badge
npx shadcn@latest add toast
```

## 常用元件速查

### Button
```tsx
import { Button } from "@/components/ui/button"

<Button variant="default">確認</Button>
<Button variant="outline">取消</Button>
<Button variant="destructive">刪除</Button>
<Button variant="ghost">Ghost</Button>
```

### Card（商品卡片、統計卡片）
```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

<Card>
  <CardHeader>
    <CardTitle>商品名稱</CardTitle>
  </CardHeader>
  <CardContent>
    <p>內容</p>
  </CardContent>
</Card>
```

### Table（訂單列表、留言列表）
```tsx
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>訂單編號</TableHead>
      <TableHead>金額</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>ORD-001</TableCell>
      <TableCell>$1,200</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

### Badge（狀態標籤）
```tsx
import { Badge } from "@/components/ui/badge"

<Badge variant="default">已付款</Badge>
<Badge variant="secondary">待處理</Badge>
<Badge variant="destructive">退款</Badge>
<Badge variant="outline">草稿</Badge>
```

### Form + Input（表單）
```tsx
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

<div className="grid gap-2">
  <Label htmlFor="email">Email</Label>
  <Input id="email" type="email" placeholder="your@email.com" />
</div>
```

### Dialog（確認對話框）
```tsx
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"

<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline">開啟</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>確認刪除？</DialogTitle>
    </DialogHeader>
    <p>此操作無法復原。</p>
  </DialogContent>
</Dialog>
```

### Toast（通知提示）
```tsx
import { useToast } from "@/components/ui/use-toast"

const { toast } = useToast()

toast({
  title: "操作成功",
  description: "訂單狀態已更新",
})
```

## Momiji Select 主題配置
shadcn/ui 使用 CSS 變數，與 Momiji 的設計系統整合：

```css
/* 在 globals.css 中调整 shadcn 主題色 */
:root {
  --primary: 25 95% 53%;        /* 楓葉橙 */
  --primary-foreground: 0 0% 100%;
}

.dark {
  --background: 222 47% 11%;    /* 深色背景 */
  --foreground: 213 31% 91%;
}
```

## 最佳實踐
1. **元件放哪** → `components/ui/`（自動生成）、自訂元件放 `components/`
2. **不要直接修改 ui/ 下的元件** → 包裝成新元件再客製
3. **使用 cn() 合併 className** → 已自動引入 `lib/utils.ts`
4. **搜尋元件文件** → https://ui.shadcn.com/docs/components/[component-name]

## 參考資源
- 官方文件：https://ui.shadcn.com
- 元件列表：https://ui.shadcn.com/docs/components
- Blocks（完整頁面範例）：https://ui.shadcn.com/blocks
