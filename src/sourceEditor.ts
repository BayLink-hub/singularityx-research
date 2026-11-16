/** Python source drafts are parsed into a syntax tree, never executed. */
import { parser } from '@lezer/python';
type SyntaxNode = ReturnType<typeof parser.parse>['topNode'];
export function validatePythonSource(code: string) {
  if (!code.trim() || new TextEncoder().encode(code).length > 100_000) return { valid: false, errors: ['Python 定义须为非空文本，最多 100 KB。'] };
  const tree = parser.parse(code), errors: string[] = [];
  let count = 0;
  const convert = (node: SyntaxNode, depth: number): any => {
    if (++count > 20_000 || depth > 100) throw new Error('代码语法树过大，请拆分定义');
    if (node.type.isError) errors.push(`第 ${code.slice(0, node.from).split('\n').length} 行附近语法不完整`);
    const children = []; for (let child = node.firstChild; child; child = child.nextSibling) children.push(convert(child, depth + 1));
    return { type: node.name, from: node.from, to: node.to, ...(children.length ? { children } : { text: code.slice(node.from, node.to) }) };
  };
  try {
    const ast = { schema: 'quant.factor.source', version: 1, kind: 'python_syntax_draft', parser: '@lezer/python', tree: convert(tree.topNode, 0), executable: false };
    const steps = []; for (let node = tree.topNode.firstChild; node; node = node.nextSibling) steps.push({ index: steps.length + 1, kind: 'source_block', operation: node.name, code: code.slice(node.from, node.to) });
    return { valid: !errors.length, code, ast, steps, dependencies: [], parameters: {}, warmup_days: null, errors,
      note: '已解析 Python 语法结构；类型、依赖和运行结果尚未验证。此源码不会在浏览器或服务器自动执行。' };
  } catch (e) { return { valid: false, errors: [e instanceof Error ? e.message : String(e)] }; }
}
