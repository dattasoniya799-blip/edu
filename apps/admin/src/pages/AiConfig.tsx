/**
 * AI 接口管理(运维)· 运行态 LLM 供应商配置 + 逐功能真假开关 + 测试连接
 * 端点:GET/PUT /admin/ai/config · GET/PUT /admin/ai/routes · POST /admin/ai/test
 * 颜色全部走 design-token 类;接口仅经 contracts client(宪法 §3)
 */
import { useCallback, useEffect, useState } from 'react';
import type { AiFeatureRoutesDto, AiProviderConfigDto, AiTestResultDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, Switch, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { Field, FormRow, RoleNote, TextInput } from '../components/controls';
import { PageHead } from './Shell';

/** 供应商配置表单态(apiKey 始终从空开始:留空=不改) */
interface ConfigForm { baseUrl: string; model: string; apiKey: string; concurrency: number }

/** 4 个功能的开关元信息(real=走真实供应商,mock=确定性假数据) */
const FEATURES: { key: keyof AiFeatureRoutesDto; label: string; desc: string }[] = [
  { key: 'qa', label: '答疑', desc: '学生做题时的 AI 引导式答疑' },
  { key: 'pre_grading', label: '预批改', desc: '主观题先由 AI 预批,教师复核后出分' },
  { key: 'class_companion', label: '课堂伴学', desc: '上课场景按编排带学生的 AI 伴学' },
  { key: 'diagnosis', label: '学情诊断', desc: '错题自动归因到知识点的诊断' },
];

function validateConfig(form: ConfigForm): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!form.baseUrl.trim()) errs.baseUrl = '请填写 Base URL';
  if (!form.model.trim()) errs.model = '请填写模型名';
  if (!Number.isInteger(form.concurrency) || form.concurrency < 1 || form.concurrency > 100)
    errs.concurrency = '并发上限须为 1–100 的整数';
  return errs;
}

export function AiConfig() {
  const [config, setConfig] = useState<AiProviderConfigDto | null>(null);
  const [form, setForm] = useState<ConfigForm>({ baseUrl: '', model: '', apiKey: '', concurrency: 1 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [routes, setRoutes] = useState<AiFeatureRoutesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingRoutes, setSavingRoutes] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResultDto | null>(null);
  const { toast } = useToast();

  /** 用读到的配置回填表单(apiKey 永远留空,因后端只回脱敏串) */
  const applyConfig = useCallback((c: AiProviderConfigDto) => {
    setConfig(c);
    setForm({ baseUrl: c.baseUrl, model: c.model, apiKey: '', concurrency: c.concurrency });
    setErrors({});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [c, r] = await Promise.all([
        api.get('/admin/ai/config'),
        api.get('/admin/ai/routes'),
      ]);
      applyConfig(c.data);
      setRoutes(r.data);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [applyConfig]);

  useEffect(() => { void load(); }, [load]);

  const saveConfig = async () => {
    const errs = validateConfig(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSavingConfig(true);
    try {
      await api.put('/admin/ai/config', {
        body: {
          baseUrl: form.baseUrl.trim(),
          model: form.model.trim(),
          concurrency: form.concurrency,
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}), // 留空=不改
        },
      });
      const refreshed = await api.get('/admin/ai/config'); // 保存后重读,key 仍脱敏
      applyConfig(refreshed.data);
      toast('供应商配置已保存,运行态即时生效');
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败,请重试');
    } finally {
      setSavingConfig(false);
    }
  };

  const toggleRoute = (key: keyof AiFeatureRoutesDto, real: boolean) => {
    setRoutes((r) => (r ? { ...r, [key]: real ? 'real' : 'mock' } : r));
  };

  const saveRoutes = async () => {
    if (!routes) return;
    setSavingRoutes(true);
    try {
      await api.put('/admin/ai/routes', { body: routes });
      toast('功能真假开关已保存');
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败,请重试');
    } finally {
      setSavingRoutes(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post('/admin/ai/test', { body: {} });
      setTestResult(r.data);
    } catch (e) {
      setTestResult({ ok: false, latencyMs: 0, sample: null, error: e instanceof Error ? e.message : '请求失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <PageHead title="AI 接口管理" sub="运行态配置大模型供应商、逐功能切真实↔mock、测试连接 · 变更对全机构生效" />

      {failed ? (
        <Card><EmptyState text="AI 接口配置加载失败" hint="请检查后端或 mock 是否就绪" action={<Button onClick={() => void load()}>重试</Button>} /></Card>
      ) : loading || !config || !routes ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[300px] w-full !rounded-lg" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Skeleton className="h-[280px] w-full !rounded-lg" />
            <Skeleton className="h-[280px] w-full !rounded-lg" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* ① 供应商配置 */}
          <Card
            title={
              <span className="flex items-center gap-2">
                供应商配置
                {config.source === 'runtime'
                  ? <Tag tone="green">运行态生效</Tag>
                  : <Tag tone="orange">env 兜底</Tag>}
              </span>
            }
          >
            <div className="flex max-w-[640px] flex-col gap-4">
              <FormRow>
                <Field label="Base URL" error={errors.baseUrl}>
                  <TextInput
                    value={form.baseUrl}
                    placeholder="https://api.example.com/v1"
                    onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  />
                </Field>
                <Field label="模型(model)" error={errors.model}>
                  <TextInput
                    value={form.model}
                    placeholder="如 qwen-plus / gpt-4o-mini"
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  />
                </Field>
              </FormRow>
              <FormRow>
                <Field label={`API Key(当前 ${config.apiKeyMasked || '未配置'})`} error={errors.apiKey}>
                  <TextInput
                    type="password"
                    autoComplete="new-password"
                    value={form.apiKey}
                    placeholder="留空=不改"
                    onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  />
                </Field>
                <Field label="全局并发上限(1–100)" error={errors.concurrency}>
                  <TextInput
                    type="number" min={1} max={100}
                    value={form.concurrency}
                    onChange={(e) => setForm((f) => ({ ...f, concurrency: Number(e.target.value) }))}
                  />
                </Field>
              </FormRow>
              <RoleNote>
                当前生效来源:{config.source === 'runtime' ? '运行态(Redis,可在此修改)' : 'env 环境变量兜底(保存后转为运行态)'}。
                API Key 仅脱敏展示,保存时留空表示沿用现有,不覆盖。
              </RoleNote>
              <div>
                <Button variant="primary" onClick={() => void saveConfig()} disabled={savingConfig}>
                  {savingConfig ? '保存中…' : '保存配置'}
                </Button>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* ② 功能真假开关 */}
            <Card title={<span className="flex items-center gap-2">功能真假开关 <Tag tone="violet">real / mock</Tag></span>}>
              <div className="flex flex-col gap-4">
                {FEATURES.map((feat, i) => {
                  const real = routes[feat.key] === 'real';
                  return (
                    <div key={feat.key} className={`flex items-center gap-3 ${i === FEATURES.length - 1 ? '' : 'border-b border-line pb-4'}`}>
                      <div className="flex-1 text-sm">
                        <b className="text-ink">{feat.label}</b>
                        <div className="mt-0.5 text-xs text-ink-3">{feat.desc}</div>
                      </div>
                      <span className="flex items-center gap-2.5">
                        {real ? <Tag tone="green">真实</Tag> : <Tag tone="gray">Mock</Tag>}
                        <Switch
                          checked={real}
                          label={`${feat.label}走真实供应商`}
                          onChange={(v) => toggleRoute(feat.key, v)}
                        />
                      </span>
                    </div>
                  );
                })}
                <RoleNote>mock = 用确定性假数据(不消耗额度、便于联调);real = 走上方配置的真实供应商。</RoleNote>
                <div>
                  <Button variant="primary" onClick={() => void saveRoutes()} disabled={savingRoutes}>
                    {savingRoutes ? '保存中…' : '保存开关'}
                  </Button>
                </div>
              </div>
            </Card>

            {/* ③ 测试连接 */}
            <Card title="测试连接">
              <div className="flex flex-col gap-4">
                <div className="text-sm text-ink-2">向当前供应商发一次最小请求,验证 Base URL / Key / 模型是否可用。</div>
                <div>
                  <Button variant="primary" onClick={() => void runTest()} disabled={testing}>
                    {testing ? '测试中…' : '测试连接'}
                  </Button>
                </div>
                {testing ? (
                  <Skeleton className="h-[44px] w-full !rounded-[10px]" />
                ) : testResult ? (
                  <div className="rounded-[10px] bg-bg px-3.5 py-3 text-[13px] leading-relaxed">
                    {testResult.ok ? (
                      <span className="font-semibold text-green">
                        ✓ 连接正常 · 延迟 {testResult.latencyMs}ms
                        {testResult.sample ? <span className="font-normal text-ink-2"> · 回文「{testResult.sample}」</span> : null}
                      </span>
                    ) : (
                      <span className="font-semibold text-red">✗ 连接失败 · {testResult.error ?? '未知错误'}</span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-ink-3">尚未测试。</div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
