'use client';

// Documento do Relatório de Aquisição em formato de papel (F5). Só apresentação:
// recebe o resultado do RPC acquisition_report. A página
// (print)/relatorios/aquisicao cuida da carga e do botão "Salvar em PDF".

import {
  resultOf,
  rowMetrics,
  totals,
  type AcquisitionReport,
} from '@/lib/acquisition/report';
import { buildInsights } from '@/lib/acquisition/insights';
import { int, money, pct, ratio } from './acquisition-report-view';

export const PDF_CSS = `
.aq{--papel:#fff;--tinta:#111;--fraco:#555;--linha:#ddd;--ruim:#b42318;--medio:#a15c07;--bom:#1a7f5a;
  background:var(--papel);color:var(--tinta);min-height:100vh;padding:32px 20px;font-size:14px;line-height:1.45}
.aq .folha{max-width:900px;margin:0 auto}
.aq h1{font-size:26px;font-weight:700;letter-spacing:-.01em;margin:0}
.aq .sub{color:var(--fraco);margin:4px 0 0}
.aq h2{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:28px 0 10px;color:var(--fraco)}
.aq .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.aq .kpi{border:1px solid var(--linha);border-radius:8px;padding:10px 12px}
.aq .kpi .l{font-size:11px;color:var(--fraco)} .aq .kpi .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.aq .kpi .h{font-size:11px;color:var(--fraco)}
.aq .neg{color:var(--ruim)}
.aq table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
.aq th{font-size:11px;font-weight:600;color:var(--fraco);text-align:right;padding:6px 8px;border-bottom:1px solid var(--tinta);white-space:nowrap}
.aq td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--linha);white-space:nowrap}
.aq th:first-child,.aq td:first-child{text-align:left;white-space:normal}
.aq .ins{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.aq .ins li{border-left:3px solid var(--linha);padding:2px 0 2px 10px}
.aq .ins li.critical{border-color:var(--ruim)} .aq .ins li.warning{border-color:var(--medio)} .aq .ins li.info{border-color:var(--bom)}
.aq .ins .n{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-right:6px}
.aq .ins .d{color:var(--fraco);font-size:12.5px}
.aq footer{border-top:1px solid var(--linha);margin-top:32px;padding-top:12px;font-size:11px;color:var(--fraco);line-height:1.6}
@page{size:A4;margin:14mm 12mm}
@media print{.nao-imprimir{display:none!important}.aq{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .aq .folha{max-width:none}.aq tr,.aq .kpi,.aq .ins li{break-inside:avoid}.aq h2{break-after:avoid}}
@media (max-width:640px){.aq .kpis{grid-template-columns:repeat(2,1fr)}.aq .tbl{overflow-x:auto}}
`;

const NIVEL = {
  critical: 'Crítico',
  warning: 'Atenção',
  info: 'Leitura',
} as const;

function fmtData(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR');
}

export function AcquisitionPdfDocument({
  report,
  accountName,
}: {
  report: AcquisitionReport;
  accountName?: string | null;
}) {
  const cur = report.currency;
  const t = totals(report);
  const insights = buildInsights(report, (v) => money(v, cur));
  const campanhas = report.campaigns
    .filter((c) => c.spend > 0 || c.sales > 0)
    .slice(0, 15);

  return (
    <>
      <div className="aq">
        <div className="folha">
          <h1>
            Relatório de aquisição{accountName ? ` · ${accountName}` : ''}
          </h1>
          <p className="sub">
            {fmtData(report.period.from)} a {fmtData(report.period.to)} · quanto
            custou cada venda e quanto ela deixou
          </p>

          <h2>Números do período</h2>
          <div className="kpis">
            <div className="kpi">
              <div className="l">Investimento</div>
              <div className="v">{t.spend > 0 ? money(t.spend, cur) : '—'}</div>
              <div className="h">
                {t.otherCost > 0
                  ? `mídia ${money(t.mediaSpend, cur)} + outros ${money(t.otherCost, cur)}`
                  : 'mídia'}
              </div>
            </div>
            <div className="kpi">
              <div className="l">Receita</div>
              <div className="v">{money(t.revenue, cur)}</div>
              <div className="h">{int(t.sales)} vendas registradas</div>
            </div>
            <div className="kpi">
              <div className="l">Resultado</div>
              <div className={`v ${t.result < 0 ? 'neg' : ''}`}>
                {money(t.result, cur)}
              </div>
              <div className="h">
                {t.marginKnown
                  ? 'após margem e comissão'
                  : 'margem não informada (100%)'}
              </div>
            </div>
            <div className="kpi">
              <div className="l">Retorno (ROAS)</div>
              <div className="v">{ratio(t.roas)}</div>
              <div className="h">receita ÷ investimento</div>
            </div>
            <div className="kpi">
              <div className="l">Custo por venda (CAC)</div>
              <div className="v">{money(t.cac, cur)}</div>
              <div className="h">investimento ÷ vendas</div>
            </div>
            <div className="kpi">
              <div className="l">Custo por lead (CPL)</div>
              <div className="v">{money(t.cpl, cur, 2)}</div>
              <div className="h">
                {int(t.leads)} leads · conversão {pct(t.conversion)}
              </div>
            </div>
          </div>

          {insights.length > 0 && (
            <>
              <h2>O que olhar</h2>
              <ul className="ins">
                {insights.map((i) => (
                  <li key={i.id} className={i.level}>
                    <div>
                      <span className="n">{NIVEL[i.level]}</span>
                      {i.title}
                    </div>
                    <div className="d">{i.detail}</div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2>Por canal</h2>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Leads</th>
                  <th>Vendas</th>
                  <th>Receita</th>
                  <th>Investimento</th>
                  <th>CAC</th>
                  <th>ROAS</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {report.channels.map((c) => {
                  const m = rowMetrics(c);
                  const res = resultOf(c.revenue, c.spend, report.settings);
                  return (
                    <tr key={c.channel_id ?? 'none'}>
                      <td>{c.name}</td>
                      <td>{int(c.leads)}</td>
                      <td>{int(c.sales)}</td>
                      <td>{money(c.revenue, cur)}</td>
                      <td>{c.spend > 0 ? money(c.spend, cur) : '—'}</td>
                      <td>{money(m.cac, cur)}</td>
                      <td>{ratio(m.roas)}</td>
                      <td className={res < 0 ? 'neg' : ''}>
                        {money(res, cur)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {campanhas.length > 0 && (
            <>
              <h2>Campanhas com investimento ou venda</h2>
              <div className="tbl">
                <table>
                  <thead>
                    <tr>
                      <th>Campanha</th>
                      <th>Investimento</th>
                      <th>Leads</th>
                      <th>Vendas</th>
                      <th>Receita</th>
                      <th>ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campanhas.map((c) => (
                      <tr key={c.campaign_key}>
                        <td>{c.campaign_name ?? c.campaign_key}</td>
                        <td>{c.spend > 0 ? money(c.spend, cur) : '—'}</td>
                        <td>{int(c.leads)}</td>
                        <td>{int(c.sales)}</td>
                        <td>{money(c.revenue, cur)}</td>
                        <td>{ratio(rowMetrics(c).roas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <footer>
            Como foi medido: venda é o negócio marcado como ganho pelo time no
            CRM, com o valor informado nele. O crédito da venda vai para o{' '}
            {report.settings.attribution_model === 'first_touch'
              ? 'primeiro'
              : 'último'}{' '}
            contato do lead (janela de {report.settings.attribution_window_days}{' '}
            dias). Investimento = mídia lida das contas de anúncio + custos
            lançados pela empresa, rateados pelos dias do período. Canal sem
            investimento registrado aparece com custo &quot;—&quot;: o custo é
            desconhecido, não zero.
            {t.unidentifiedLeads > 0 &&
              ` ${int(t.unidentifiedLeads)} leads do período não têm canal identificado.`}
            <br />
            Central de Receita · gerado em{' '}
            {new Date().toLocaleDateString('pt-BR')}
          </footer>
        </div>
      </div>
    </>
  );
}
