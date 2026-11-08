# 标题解析策略设计与实施计划

## 背景与现状
当前文档打印与渲染逻辑中，若调用方未显式传入 `title` 且正文首行未使用一级标题（`# 标题`），`resolveDocumentTitle` 会默认采用模板名称（默认模板即“通用讲义”）作为文档的大标题渲染在页面顶部 `<h1>`。该逻辑导致打印无大标题正文时出现意外的“通用讲义”字样。

## 设计目标
将大标题的判定收敛为显式输入，彻底取消模板名称兜底逻辑：
1. 存在显式标题时（调用参数 `title` 或 Markdown 文首 `# 标题`），渲染对应大标题。
2. 未提供显式标题时，文档标题设为空字符串，页面不渲染 `<h1>` 与副标题，直接呈现正文内容。

## 详细改动点
1. `lib/core.js`：
   - 简化 `resolveDocumentTitle`：仅保留 `explicitTitle` 的清洗与返回，缺省直接返回空字符串 `""`。
2. `lib/index.js`：
   - 更新工具声明中 `title` 字段的描述，说明缺省时从正文提取或保持无标题。
3. `test/core.test.js`：
   - 更新 `resolveDocumentTitle` 单元测试，验证无显式标题的正文统一返回空字符串。
4. `test/routes.test.js`：
   - 验证并调整相关集成测试用例。

## 实施计划
1. 修改 `lib/core.js` 中的 `resolveDocumentTitle` 函数实现。
2. 修改 `lib/index.js` 中的工具参数描述。
3. 更新 `test/core.test.js` 中相关的断言。
4. 执行 `npm test` 验证全部测试通过。
