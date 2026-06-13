// 把 *.json 导入声明为 any，避免 tsc 对大体积 JSON 推断字面量类型（会拖慢/卡死类型检查）。
// 实际打包由 wrangler/esbuild 完成。
declare module "*.json" {
  const value: any;
  export default value;
}
