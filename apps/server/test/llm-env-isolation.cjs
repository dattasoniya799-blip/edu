/**
 * e2e LLM 环境隔离补丁(setupFilesAfterEnv,每个用例前执行)。默认 no-op,仅在显式置
 * `E2E_LLM_ISOLATION=1` 时生效 —— 不改变 main/常规 run 的任何行为。
 *
 * 背景:与演示并跑时,主仓库 apps/server/.env 含真实 LLM_API_KEY(DeepSeek)。worktree 的
 * node_modules 经 symlink 指向主仓库,Prisma 生成客户端的 .env 路径被烘焙为主仓库;当某 spec
 * 先 `delete process.env.LLM_API_KEY` 再 createApp,PrismaModule 初始化 PrismaClient 会从主 .env
 * 把真实 key 回灌进 process.env(对"已定义空串"则不回灌),污染"未配 key"断言(a7 healthy()=false)。
 *
 * 处理:开启隔离时,每个用例前把 LLM key/model 复位为定义态空串 —— 既挡住 Prisma 回灌(变量已
 * 定义),又等价"未配 key"。需要真实/测试 key 的用例在自身 it 体内显式设置(在本 beforeEach 之后),
 * 不受影响。纯测试隔离,不改任何生产代码。
 */
beforeEach(() => {
  if (process.env.E2E_LLM_ISOLATION === '1') {
    process.env.LLM_API_KEY = '';
    process.env.LLM_MODEL = '';
  }
});
