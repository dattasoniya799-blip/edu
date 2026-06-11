import SwaggerParser from '@apidevtools/swagger-parser';
try {
  const api = await SwaggerParser.validate('openapi.yaml');
  const n = Object.keys(api.paths).length;
  const ops = Object.values(api.paths).reduce((s, p) => s + Object.keys(p).length, 0);
  console.log(`OpenAPI 校验通过 ✓  paths=${n} operations=${ops}`);
} catch (e) { console.error('OpenAPI 校验失败:', e.message); process.exit(1); }
