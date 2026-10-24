# Tavern Token Lens 1.0.1

独立的 SillyTavern / TauriTavern 前端扩展，提供浮动 Token 统计面板。

## 功能
- 输入、输出、总 Token
- 生成总耗时、首 Token 延迟（仅部分流式响应可测）、估算输出速度
- 当前模型名称、请求方式、数据来源
- 当前会话累计请求数、Token、耗时、估算请求数
- 最近 8 条记录、复制统计、CSV 导出、清空累计
- 最多保留 500 条本地统计记录

## 兼容性修复（1.0.1）
- 将 `script.js` 改为可选的动态导入。如果 TauriTavern 的 WebView 暂时无法提供该模块，面板仍会尝试加载；依赖酒馆事件和上下文的统计功能会在 API 不可用时降级。
- 这不能修复扩展文件本身未被 TauriTavern 正确安装或资源路由返回 404 的情况；请确保扩展文件确实存在于酒馆扫描的目录。

## 数据与准确性说明
1. API 返回 `usage` 字段时，尽力读取真实用量；但酒馆通常经由后端代理请求，前端扩展未必能看到原始供应商响应。
2. 如果无法读取真实 usage，输入/输出 Token 使用字符规则粗估，来源标为“本地估算”。中文、英文、代码、特殊 Token、图像/音频输入都可能导致较大误差。
3. 计时基于酒馆前端生成事件，可能包含网络、排队、后端处理时间；不等同于纯模型推理时间。
4. 模型/方式显示依赖当前 TauriTavern/SillyTavern 暴露的前端上下文，个别自定义接口可能显示“未识别”。
5. 数据保存在当前酒馆 WebView 的 `localStorage` 中；清除站点数据会丢失累计统计。不会上传统计数据，也不会更改聊天内容。

## 安装（TauriTavern 桌面版）
**优先使用 TauriTavern 的扩展管理器通过 Git 仓库地址安装：**

`https://github.com/winxwang/TavernTokenLens`

如果你需要手动安装，请将整个 `TavernTokenLens` 文件夹（文件夹内直接放置 `manifest.json`、`index.js`、`style.css`）放到当前 TauriTavern 版本实际扫描的第三方扩展目录。常见全局目录为：

`data/extensions/third-party/TavernTokenLens/`

注意：不要把仓库根目录的三个文件直接散放到 `third-party` 目录，也不要多套一层文件夹（例如 `TavernTokenLens/TavernTokenLens/index.js`）。若扩展管理器安装后仍报 `Failed to fetch dynamically imported module`，通常需要检查安装目录/资源路由；单纯修改扩展代码无法让缺失的本地文件自动出现。

## 文件
- `manifest.json`：扩展清单
- `index.js`：统计与 UI
- `style.css`：悬浮面板样式
