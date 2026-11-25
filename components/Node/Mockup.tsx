'use client';

// ═══════════════════════════════════════════════════════════
// 📁 components/Node/Mockup.tsx
// 기기 목업 — 아이폰 · 아이패드 Pro 11/13 틀 안 화면에 이미지를 끼워 넣는 도형
//
//   이미지 넣기: 더블클릭(파일 선택) · 파일을 끌어다 놓기 · 목업을 고르고 Ctrl+V (Canvas)
//   모든 치수는 기기별 설계 단위(pt) × 배율로 계산 → 어떤 크기로 늘려도 비율이 그대로
//   SVG 대신 HTML로 그림 — PNG 내보내기(html-to-image)에서도 화면 그대로 나옴
// ═══════════════════════════════════════════════════════════

import { useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ImagePlus } from 'lucide-react';
import { prepareCanvasImage } from '@/utils/canvasImage';
import type { NodeData } from '@/types';
import { useCanvasStore } from '@/store/canvasStore';
import { tr } from '@/lib/i18n';

const BTN = 3;   // 버튼이 몸체 밖으로 나온 정도 (모든 기기 공통)

// 기기별 설계 단위 — 화면 크기는 실제 pt, 틀·베젤은 실물 비율
//   아이폰: iPhone 16 Pro (화면 402×874, 검은 베젤 8, 티타늄 틀 5, 버튼은 양옆에만)
//   아이패드: iPad Pro M4/M5 (베젤+틀 ≈ 8.5mm ≈ 44pt, 버튼은 위·오른쪽)
export const MOCKUP_DEVICES = {
  iphone: { label: tr('아이폰', 'iPhone'),   name: tr('아이폰', 'iPhone'),            screenW: 402,  screenH: 874,  frame: 5, bezel: 8,  screenR: 62, padX: BTN, padY: 0,   size: { w: 260, h: 539 } },
  ipad11: { label: 'iPad 11', name: tr('아이패드 Pro 11인치', 'iPad Pro 11-inch'), screenW: 834,  screenH: 1210, frame: 9, bezel: 35, screenR: 22, padX: BTN, padY: BTN, size: { w: 400, h: 562 } },
  ipad13: { label: 'iPad 13', name: tr('아이패드 Pro 13인치', 'iPad Pro 13-inch'), screenW: 1032, screenH: 1376, frame: 9, bezel: 35, screenR: 22, padX: BTN, padY: BTN, size: { w: 480, h: 627 } },
} as const;
export type MockupDevice = keyof typeof MOCKUP_DEVICES;

export const mockupDevice = (data: Pick<NodeData, 'mockupDevice'>): MockupDevice =>
  data.mockupDevice && data.mockupDevice in MOCKUP_DEVICES ? data.mockupDevice : 'iphone';

// 기기 전체 설계 크기 (버튼 여백 포함, 세로 기준)
export function mockupDesignSize(device: MockupDevice) {
  const d = MOCKUP_DEVICES[device];
  const ring = (d.frame + d.bezel) * 2;
  return { w: d.screenW + ring + d.padX * 2, h: d.screenH + ring + d.padY * 2 };
}

// 새로 만들 때 기본 크기 (가로면 뒤집음)
export function mockupDefaultSize(device: MockupDevice, landscape = false) {
  const { w, h } = MOCKUP_DEVICES[device].size;
  return landscape ? { w: h, h: w } : { w, h };
}

// 틀 색 — 가운데색 / 빛 받는 색 / 그늘색
export const MOCKUP_COLORS = {
  natural:    { label: tr('내추럴 티타늄', 'Natural Titanium'), base: '#b9b3a9', light: '#e6e1d8', shade: '#7b756c' },
  black:      { label: tr('블랙 티타늄', 'Black Titanium'),   base: '#3a3a3c', light: '#6b6b6e', shade: '#19191b' },
  white:      { label: tr('화이트 티타늄', 'White Titanium'), base: '#e8e6e1', light: '#ffffff', shade: '#b3b0a9' },
  desert:     { label: tr('데저트 티타늄', 'Desert Titanium'), base: '#c8aa90', light: '#eed8c3', shade: '#8d715a' },
  spaceBlack: { label: tr('스페이스 블랙', 'Space Black'), base: '#3b3b3e', light: '#69696d', shade: '#1b1b1d' },
  silver:     { label: tr('실버', 'Silver'),          base: '#d7d8db', light: '#f5f6f7', shade: '#a2a4a8' },
} as const;
export type MockupColor = keyof typeof MOCKUP_COLORS;

// 기기마다 고를 수 있는 색 (첫 번째가 기본)
export const DEVICE_COLORS: Record<MockupDevice, MockupColor[]> = {
  iphone: ['natural', 'black', 'white', 'desert'],
  ipad11: ['spaceBlack', 'silver'],
  ipad13: ['spaceBlack', 'silver'],
};
export function mockupColorKey(data: Pick<NodeData, 'mockupDevice' | 'mockupColor'>): MockupColor {
  const list = DEVICE_COLORS[mockupDevice(data)];
  const k = data.mockupColor as MockupColor | undefined;
  return k && list.includes(k) ? k : list[0];
}

export function MockupShape({ data, id, width, height }: { data: NodeData; id: string; width: number; height: number }) {
  const { updateNodeData } = useReactFlow();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setBusy]    = useState(false);
  const [dropping, setDropping] = useState(false);
  // 화면 프레임을 찍어 넣는 중 (Canvas)
  const capturing = useCanvasStore((s) => s.mockupBusyId === id);
  // 캔버스의 사진·화면을 끌어 가까이 오면 강조 (놓으면 들어간다는 표시)
  const hovering = useCanvasStore((s) => s.imageDropTargetId === id);
  const lit = dropping || hovering;
  const busy = uploading || capturing;

  const device = mockupDevice(data);
  const dev    = MOCKUP_DEVICES[device];
  const tablet = device !== 'iphone';
  const { w: DW, h: DH } = mockupDesignSize(device);
  const BODY_R = dev.screenR + dev.bezel + dev.frame;

  // 틀 비율을 지키며 상자 안에 맞춤 (가운데 정렬)
  // 가로 방향: 세로로 그린 기기를 왼쪽으로 90° 눕히고, 화면 속 내용만 다시 바로 세움
  const landscape = data.mockupOrientation === 'landscape';
  const u  = landscape ? Math.min(width / DH, height / DW) : Math.min(width / DW, height / DH);
  const px = (n: number) => n * u;
  const c  = MOCKUP_COLORS[mockupColorKey(data)];
  const shadow = data.mockupShadow !== false;
  const fit    = data.mockupFit === 'contain' ? 'contain' : 'cover';
  // 화면 속 이미지 확대(100~300%) · 위치(0~100%) — 비율이 안 맞는 이미지를 원하는 부분에 맞출 때
  const zoom = Math.max(100, (data.mockupZoom as number | undefined) ?? 100) / 100;
  const posX = (data.mockupPosX as number | undefined) ?? 50;
  const posY = (data.mockupPosY as number | undefined) ?? (fit === 'cover' ? 0 : 50);
  // 눕히면 기기 기준 방향이 돌아감 — 화면 기준 "아래"로 가는 그림자·빛을 기기 기준으로 바꿈 (아래 → 왼쪽)
  const off = (down: number) => (landscape ? `${px(-down)}px 0` : `0 ${px(down)}px`);
  const { screenW: SCREEN_W, screenH: SCREEN_H } = dev;
  // 안내 글씨 — 큰 화면에서도 비슷한 비율로 보이게
  const t = tablet ? 1.9 : 1;

  const setImage = async (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    setBusy(true);
    try {
      const img = await prepareCanvasImage(file);
      updateNodeData(id, { imageUrl: img.src });
    } catch (err) {
      console.error(err);
      alert(tr('이미지를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'Could not upload the image. Please try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  // 아이폰 옆면 버튼 — 몸체 뒤에 깔려 바깥으로 3만큼만 보임
  const sideBtn = (side: 'left' | 'right', top: number, h: number) => (
    <div
      key={`${side}-${top}`}
      style={{
        position: 'absolute', [side]: 0, top: px(top), width: px(BTN + 3), height: px(h),
        borderRadius: px(2),
        background: `linear-gradient(${side === 'left' ? 90 : 270}deg, ${c.shade}, ${c.light} 45%, ${c.base})`,
      }}
    />
  );
  // 아이패드 버튼 — 위 가장자리(전원) · 오른쪽 가장자리(음량)
  const topBtn = (right: number, w: number) => (
    <div
      key={`top-${right}`}
      style={{
        position: 'absolute', top: 0, right: px(right), width: px(w), height: px(BTN + 3), borderRadius: px(2),
        background: `linear-gradient(180deg, ${c.shade}, ${c.light} 45%, ${c.base})`,
      }}
    />
  );
  // 안테나 띠 — 틀 위의 가는 줄 (아이폰)
  const band = (side: 'left' | 'right', top: number) => (
    <div
      key={`band-${side}-${top}`}
      style={{ position: 'absolute', [side]: 0, top: px(top), width: px(dev.frame), height: px(2.5), background: 'rgba(0,0,0,0.22)' }}
    />
  );

  return (
    <div
      style={{
        width, height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: (data.opacity ?? 100) / 100, userSelect: 'none',
      }}
      onDoubleClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault(); e.stopPropagation();
        setDropping(false);
        void setImage(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')));
      }}
    >
      <input
        ref={fileRef} type="file" accept="image/*" hidden
        onChange={(e) => { void setImage(e.target.files?.[0]); e.target.value = ''; }}
      />
      <div style={{ position: 'relative', width: px(landscape ? DH : DW), height: px(landscape ? DW : DH), flexShrink: 0 }}>
      <div
        style={{
          position: 'absolute', width: px(DW), height: px(DH),
          left: landscape ? px((DH - DW) / 2) : 0, top: landscape ? px((DW - DH) / 2) : 0,
          transform: landscape ? 'rotate(-90deg)' : undefined,
        }}
      >
        {tablet ? (
          <>
            {/* 아이패드 버튼: 위 전원 / 오른쪽 음량 올림·내림 */}
            {topBtn(BTN + 70, 96)}
            {sideBtn('right', 120, 64)}
            {sideBtn('right', 196, 64)}
          </>
        ) : (
          <>
            {/* 아이폰 버튼: 왼쪽 동작·음량 올림·내림 / 오른쪽 전원·카메라 컨트롤 */}
            {sideBtn('left', 172, 34)}
            {sideBtn('left', 236, 62)}
            {sideBtn('left', 314, 62)}
            {sideBtn('right', 266, 100)}
            {sideBtn('right', 520, 58)}
          </>
        )}

        {/* 몸체 — 금속 틀 (양옆으로 빛이 도는 느낌) */}
        <div
          style={{
            position: 'absolute', left: px(dev.padX), top: px(dev.padY), width: px(DW - dev.padX * 2), height: px(DH - dev.padY * 2),
            borderRadius: px(BODY_R), overflow: 'hidden',
            background: tablet
              ? `linear-gradient(90deg, ${c.shade} 0%, ${c.light} 0.5%, ${c.base} 1.4%, ${c.base} 98.6%, ${c.light} 99.5%, ${c.shade} 100%)`
              : `linear-gradient(90deg, ${c.shade} 0%, ${c.light} 1.2%, ${c.base} 3.5%, ${c.base} 96.5%, ${c.light} 98.8%, ${c.shade} 100%)`,
            boxShadow: [
              `inset 0 0 0 ${px(0.8)}px rgba(255,255,255,0.28)`,
              `inset ${off(1.5)} ${px(2)}px rgba(255,255,255,0.35)`,
              `inset ${off(-1.5)} ${px(2)}px rgba(0,0,0,0.3)`,
              ...(shadow ? [`${off(36)} ${px(70)}px ${px(-24)}px rgba(0,0,0,0.45)`, `${off(14)} ${px(28)}px ${px(-12)}px rgba(0,0,0,0.3)`] : []),
            ].join(', '),
          }}
        >
          {!tablet && <>{band('left', 96)}{band('right', 96)}{band('left', 802)}{band('right', 802)}</>}

          {/* 검은 베젤 */}
          <div
            style={{
              position: 'absolute', inset: px(dev.frame), borderRadius: px(BODY_R - dev.frame),
              background: '#050505', boxShadow: `inset 0 0 0 ${px(1)}px #2b2b2d`,
            }}
          />

          {/* 화면 */}
          <div
            style={{
              position: 'absolute', inset: px(dev.frame + dev.bezel), borderRadius: px(dev.screenR), overflow: 'hidden',
              background: data.imageUrl ? '#000' : 'linear-gradient(160deg, #2c2e35, #15161a)',
              outline: lit ? `${px(6 * t)}px solid #818cf8` : undefined, outlineOffset: px(-6 * t),
            }}
          >
          {/* 화면 내용 — 가로 방향이면 눕힌 기기 안에서 다시 바로 세움 */}
          <div
            style={{
              position: 'absolute',
              width: px(landscape ? SCREEN_H : SCREEN_W), height: px(landscape ? SCREEN_W : SCREEN_H),
              left: landscape ? px((SCREEN_W - SCREEN_H) / 2) : 0, top: landscape ? px((SCREEN_H - SCREEN_W) / 2) : 0,
              transform: landscape ? 'rotate(90deg)' : undefined,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: px(14 * t),
              color: 'rgba(255,255,255,0.72)', textAlign: 'center',
            }}
          >
            {data.imageUrl ? (
              <img
                src={data.imageUrl}
                alt=""
                draggable={false}
                style={{
                  width: '100%', height: '100%', objectFit: fit, objectPosition: `${posX}% ${posY}%`, display: 'block',
                  ...(zoom > 1 ? { transform: `scale(${zoom})`, transformOrigin: `${posX}% ${posY}%` } : {}),
                }}
              />
            ) : (
              <>
                <ImagePlus size={px(64 * t)} strokeWidth={1.4} />
                <div style={{ fontSize: px(24 * t), fontWeight: 600, lineHeight: 1.3 }}>{busy ? tr('올리는 중…', 'Uploading…') : tr('이미지 넣기', 'Add image')}</div>
                {!busy && (
                  <div style={{ fontSize: px(17 * t), lineHeight: 1.5, color: 'rgba(255,255,255,0.45)' }}>
                    {tr('더블클릭 · 파일 끌어다 놓기', 'Double-click · drag a file in')}<br />{tr('선택하고 Ctrl+V', 'or select and Ctrl+V')}
                  </div>
                )}
              </>
            )}
            {lit && !busy && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(99,102,241,0.35)', color: '#fff', fontSize: px(26 * t), fontWeight: 700,
              }}>{tr('놓으면 화면에 넣기', 'Drop to place on screen')}</div>
            )}
            {busy && data.imageUrl && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: px(24 * t), fontWeight: 600,
              }}>{tr('올리는 중…', 'Uploading…')}</div>
            )}
          </div>
          </div>

          {tablet ? (
            // 아이패드 전면 카메라 — 긴 쪽(오른쪽) 베젤 가운데 → 가로로 눕히면 위쪽 가운데
            <div
              style={{
                position: 'absolute', right: px(dev.frame + dev.bezel / 2 - 6), top: '50%', width: px(12), height: px(12),
                marginTop: px(-6), borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 35%, #2b3554 0%, #0d101c 55%, #05060a 100%)',
                boxShadow: `0 0 0 ${px(1.5)}px #141416`,
              }}
            />
          ) : (
            // 다이내믹 아일랜드 + 카메라 렌즈
            <div
              style={{
                position: 'absolute', left: '50%', top: px(dev.frame + dev.bezel + 11), width: px(124), height: px(36),
                marginLeft: px(-62), borderRadius: px(18), background: '#000',
              }}
            >
              <div
                style={{
                  position: 'absolute', right: px(11), top: px(11), width: px(14), height: px(14), borderRadius: '50%',
                  background: 'radial-gradient(circle at 35% 35%, #2b3554 0%, #0d101c 55%, #05060a 100%)',
                }}
              />
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
