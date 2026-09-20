/** No DeepSeek fallback: this diagnostic must identify Jev access failures honestly. */
import { experimental_evaluate as evaluate } from 'ai';
async function main() {
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!key) throw new Error('请先在私有 .env.local 中配置 AI_GATEWAY_API_KEY；不要将密钥发到聊天或提交到 Git。');
  const response = await fetch('https://ai-gateway.vercel.sh/typesafe/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  console.log(JSON.stringify({ metadataHttpStatus: response.status, evaluationRequested: process.argv.includes('--evaluate') }));
  if (!response.ok) throw new Error(`Gateway 返回 ${response.status}；请在 Vercel 控制台检查密钥、团队权限与免费模型资格。`);
  if (!process.argv.includes('--evaluate')) { console.log('只检查了模型列表访问，未调用模型，尚不能证明 Jev 推理免绑卡可用。'); return; }
  const result = await evaluate({ model: 'typesafe-ai/jev', state: { text: 'This article describes how a company earns subscription revenue.' }, questions: { business: { type: 'boolean', instructions: 'Does the text describe a business revenue model?' } }, maxRetries: 0, abortSignal: AbortSignal.timeout(15000) });
  console.log(JSON.stringify({ answer: result.answers.business, usage: result.usage, note: '仅为接入测试，不能证明真实文章判断准确度。' }));
}
main().catch((error) => { console.error(error instanceof Error && !process.env.AI_GATEWAY_API_KEY ? error.message : 'Jev 检查未完成。检查 Vercel Gateway 的权限、额度、模型资格和网络；不自动充值或重试。'); process.exitCode = 1; });
