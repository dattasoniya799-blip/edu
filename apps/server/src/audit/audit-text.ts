/**
 * 审计动作码 → 给人看的一句话(管理端「最近动态」用;走查 E-3:此前直接显示 `王校长 · auth.login`)。
 * 模板占位:{actor} 操作者姓名;{target} 目标名称(用户名 / 课程名;取不到时退化为「#id」或空)。
 * 未登记的动作码回退为「{actor} 执行了 <code>」,不抛错,新增动作码忘记登记也不影响页面。
 */
export const AUDIT_TEXT: Record<string, string> = {
  'auth.login': '{actor} 登录了系统',
  'auth.student_login': '{actor} 登录了学生端',
  'auth.logout': '{actor} 退出了登录',
  'me.password_change': '{actor} 修改了自己的密码',
  'admin.teacher.create': '{actor} 新建了教师 {target}',
  'admin.teacher.update': '{actor} 修改了教师 {target} 的资料',
  'admin.teacher.disable': '{actor} 停用了教师 {target}',
  'admin.teacher.enable': '{actor} 启用了教师 {target}',
  'admin.teacher.reset_password': '{actor} 重置了教师 {target} 的密码',
  'admin.student.create': '{actor} 新建了学生 {target}',
  'admin.student.update': '{actor} 修改了学生 {target} 的资料',
  'admin.student.disable': '{actor} 停用了学生 {target}',
  'admin.student.enable': '{actor} 启用了学生 {target}',
  'admin.student.reset_password': '{actor} 重置了学生 {target} 的密码',
  'admin.course.create': '{actor} 新建了课程 {target}',
  'admin.course.update': '{actor} 修改了课程 {target}',
  'admin.course.add_students': '{actor} 给课程 {target} 添加了学生',
  'admin.course.remove_student': '{actor} 将学生移出了课程 {target}',
  'admin.ai_quota.update': '{actor} 调整了 AI 额度',
  'admin.settings.update': '{actor} 修改了平台设置',
  'admin.ai_config.update': '{actor} 修改了 AI 接口配置',
  'admin.ai_routes.update': '{actor} 切换了 AI 功能真假路由',
  'admin.feature.stage_update': '{actor} 调整了实验室功能阶段',
  'admin.feature.whitelist_update': '{actor} 修改了实验室白名单',
  'courseware.job.create': '{actor} 发起了 AI 课件生成',
  'ai.quota.alert': 'AI 用量达到告警阈值',
  'seed.business': '演示数据已初始化',
};

export function renderAuditText(action: string, actor: string, target: string | null): string {
  const tpl = AUDIT_TEXT[action];
  if (!tpl) return `${actor} 执行了 ${action}`;
  return tpl
    .replace('{actor}', actor)
    .replace(' {target}', target ? ` ${target}` : '')
    .replace('{target}', target ?? '');
}
