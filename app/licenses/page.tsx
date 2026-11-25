// ═══════════════════════════════════════════════════════════
// 📁 app/licenses/page.tsx
// 오픈소스 라이선스 고지 — 설정(⚙) 메뉴의 "오픈소스 라이선스"에서 새 탭으로 열림
//   MIT·ISC는 "저작권 고지 포함"이 조건인데 빌드하면 주석이 빠지므로 여기서 고지
//   목록은 constants/thirdParty.ts, 원본 문서는 THIRD_PARTY_NOTICES.md
// ═══════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { FONTS, ICONS, LIBRARIES, LICENSE_TEXT, TRADEMARK_NOTICE, type ThirdPartyItem } from '@/constants/thirdParty';

export const metadata: Metadata = { title: '오픈소스 라이선스' };

const t = (s: string) => s;   // 한국어만 씀

const Section = ({ title, items, t }: { title: string; items: ThirdPartyItem[]; t: (s: string) => string }) => (
  <section style={{ marginTop: 36 }}>
    <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>{title}</h2>
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--border-light)' }}>
      {items.map((it) => (
        <li key={it.name} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <a href={it.url} target="_blank" rel="noopener noreferrer"
               style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
              {t(it.name)}
            </a>
            {it.version && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{it.version}</span>}
            <span style={{
              fontSize: 12, padding: '1px 7px', borderRadius: 999,
              border: '1px solid var(--border-lighter)', color: 'var(--text-secondary)',
            }}>{it.license}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{it.copyright}</div>
          {it.note && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{t(it.note)}</div>}
        </li>
      ))}
    </ul>
  </section>
);

export default function LicensesPage() {
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 20px 80px', lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>오픈소스 라이선스</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
          Web Canvas는 아래 오픈소스 폰트·아이콘·라이브러리를 사용합니다. 각 저작권자에게 감사드립니다.
        </p>

        <Section title="폰트" items={FONTS} t={t} />
        <Section title="아이콘" items={ICONS} t={t} />
        <Section title="라이브러리" items={LIBRARIES} t={t} />

        <section style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>라이선스 전문</h2>
          {(Object.keys(LICENSE_TEXT) as ThirdPartyItem['license'][]).map((k) => (
            <details key={k} style={{ marginBottom: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{k}</summary>
              <pre style={{
                whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text-secondary)',
                background: 'var(--bg-secondary)', padding: 14, borderRadius: 8, marginTop: 8,
              }}>{t(LICENSE_TEXT[k])}</pre>
            </details>
          ))}
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>상표</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{t(TRADEMARK_NOTICE)}</p>
        </section>
      </main>
    </div>
  );
}
