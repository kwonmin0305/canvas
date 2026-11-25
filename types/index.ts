// ═══════════════════════════════════════════════════════════
// 📌 TypeScript 타입 정의
// ═══════════════════════════════════════════════════════════

import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';
//       ↑ React Flow 라이브러리에서 Node와 Edge 타입을 가져옴

// ── 노드 관련 타입 ───────────────────────────────────────────
export type NodeType =
  | 'mobile'
  | 'admin'
  | 'cdn'
  | 'gateway'
  | 'load_balancer'
  | 'api_server'
  | 'auth'
  | 'database'
  | 'cache'
  | 'storage'
  | 'container'
  | 'payment_api'
  | 'oauth_api'
  | 'ai_api'
  | 'messaging_api'
  | 'maps_api'
  | 'data_api'
  | 'search_api'
  | 'social_api'
  | 'security_api'
  | 'translate_api'
  | 'finance_api'
  | 'client'
  | 'worker'
  | 'server'
  | 'service'
  | 'queue'
  | 'message_bus'
  | 'api'
  | 'function';
//                        ↑ 노드의 종류

export type NodeStatus = 'ok' | 'err' | 'warn' | 'none';
//                        ↑ 노드의 상태 (4가지만 가능)

export type NodeShape  =
  | 'card'        // ← 아키텍처 카드 (액센트 바 + 아이콘)
  | 'rectangle'   // ← 플레인 사각형 (텍스트 라벨용)
  | 'circle'      // ← 원
  | 'diamond'     // ← 마름모 (조건 분기)
  | 'cylinder'    // ← 실린더 (DB)
  | 'cloud'       // ← 클라우드 (외부 서비스)
  | 'document'    // ← 문서 파일
  | 'hexagon'     // ← 육각형
  | 'triangle'    // ← 삼각형
  | 'note'        // ← 메모
  | 'frame'       // ← 프레임 컨테이너 (Excalidraw 스타일)
  | 'text'        // ← 텍스트 박스 (투명 배경, 비례 폰트)
  | 'table'       // ← 워드 스타일 표 (행/열 셀 편집)
  | 'anchor'      // ← 자유 화살표 끝점 (보이지 않는 작은 앵커)
  | 'drawing'     // ← 자유 손글씨 드로잉
  | 'image'       // ← 붙여넣은 이미지 (Ctrl+V)
  | 'code'        // ← 코드 블록 (고정폭, 줄바꿈 없음)
  | 'list'        // ← Notion식 목록 (글머리 기호·번호·할 일·토글)
  | 'callout'     // ← 콜아웃 (아이콘 + 강조 배경 상자)
  | 'page'        // ← 하위 페이지 (더블클릭하면 모달로 열림)
  | 'mockup'      // ← 기기 목업 (아이폰 · 아이패드) (화면에 이미지를 끼워 넣음)
  | 'entity';     // ← DB 테이블 (ERD) — 이름 + 컬럼 목록, 컬럼끼리 관계선 (lib/erd)

// ── DB 테이블(entity)의 컬럼 한 줄 ─────────────────────────────
export interface EntityColumn {
  id:        string;
  name:      string;
  type:      string;     // ← 실제 DB 타입 (text · int · uuid …) — 화면에는 쉬운 이름으로도 보여 줌
  pk?:       boolean;    // ← 대표 번호 (Primary key)
  nullable?: boolean;    // ← 비워 둘 수 있음 (없으면 필수)
  unique?:   boolean;    // ← 중복 불가
  note?:     string;     // ← 한글 설명
  default?:  string;     // ← 기본값 (SQL 식 그대로)
}

// ── Notion식 블록 (목록·콜아웃·페이지 안의 한 줄) ──────────────
export type BlockKind = 'text' | 'bullet' | 'number' | 'todo' | 'toggle';

export interface BlockItem {
  id:       string;
  kind:     BlockKind;
  text:     string;
  indent:   number;     // ← 들여쓰기 단계 (0부터). 바로 위 블록보다 깊으면 그 블록의 하위 항목
  checked?: boolean;    // ← 할 일 완료 여부
  open?:    boolean;    // ← 토글 펼침 여부
}

// React Flow 노드 안의 data 필드
export interface NodeData {
  title:        string;                      // ← 노드의 제목
  subtitle:     string;                      // ← 노드의 부제목
  icon:         string;                      // ← 아이콘 이름
  type:         NodeType;                    // ← 노드의 종류
  status:       NodeStatus;                  // ← 노드의 상태
  shape:        NodeShape;                   // ← 노드의 모양
  // 스타일 속성
  strokeColor?: string;                      // ← 테두리 색
  bgColor?:     string;                      // ← 배경색
  strokeWidth?: number;                      // ← 1 | 2 | 3
  strokeStyle?: 'solid' | 'dashed' | 'dotted'; // ← 테두리 스타일
  borderRadius?: number;                     // ← 0~32px
  opacity?:     number;                      // ← 0~100
  width?:       number;                      // ← 리사이즈된 너비 (px)
  height?:      number;                      // ← 리사이즈된 높이 (px)
  // 텍스트 박스 전용
  fontScale?:   number;                      // ← fontSize = height × fontScale (기본 0.27)
  fontWeight?:  'normal' | 'medium' | 'semibold' | 'bold';   // ← 굵기 (400 · 500 · 600 · 700)
  fontStyle?:   'normal' | 'italic';         // ← 이탤릭
  fontFamily?:  'normal' | 'handwriting' | 'mono' | 'serif'; // ← 폰트 패밀리
  fontColor?:   string;                      // ← 글자 색 (hex)
  // 카드 아이콘 — 안 정하면 이름 글씨색 · 카드 크기에 맞춘 크기
  iconColor?:   string;                      // ← 아이콘 색 (hex)
  iconSize?:    number;                      // ← 아이콘 크기 (px)
  // 손글씨 드로잉 전용
  drawingPoints?: number[][];                // ← 경로 점 목록 [[x,y], ...] (노드 기준 상대좌표)
  drawingColor?:  string;                    // ← 선 색상
  drawingWidth?:  number;                    // ← 선 두께
  // 이미지 전용
  imageUrl?:      string;                    // ← data URL (https 주소일 수도 있음)
  // 세부 속성 (속성 패널 "세부" — 사각형·원)
  shadow?:        number;                    // ← 그림자 0 없음 · 1 약하게 · 2 보통 · 3 강하게
  textPadding?:   number;                    // ← 도형 안 글씨의 안쪽 여백 (px, 없으면 도형별 기본값)
  lineHeight?:    number;                    // ← 줄 높이 배수 (기본 1.4)
  letterSpacing?: number;                    // ← 자간 (px, 기본 0)
  groupId?:       string;                    // ← 묶음 번호 — 같은 번호끼리 한 덩어리로 선택·이동 (utils/group.ts)
  // 기기 목업 전용 (화면 이미지는 imageUrl)
  mockupDevice?:  'iphone' | 'ipad11' | 'ipad13'; // ← 기기 (기본 아이폰)
  mockupColor?:   'natural' | 'black' | 'white' | 'desert' | 'spaceBlack' | 'silver'; // ← 틀 색 (아이폰 기본 내추럴 · 아이패드 기본 스페이스 블랙)
  mockupFit?:     'cover' | 'contain';       // ← 화면 채우기(기본) / 전체 보이기
  mockupShadow?:  boolean;                   // ← 그림자 (기본 켜짐)
  mockupOrientation?: 'portrait' | 'landscape'; // ← 세로(기본) / 가로
  imageSlot?:     boolean;                   // ← 와이어프레임 "이미지" 칸 — 사진을 넣을 수 있음 (utils/imageSlot.ts, 사진은 imageUrl)
  mockupZoom?:    number;                    // ← 화면 이미지 확대 % (100~300, 기본 100) — 이미지 칸도 같이 씀
  mockupPosX?:    number;                    // ← 화면 이미지 좌우 위치 % (기본 50)
  mockupPosY?:    number;                    // ← 화면 이미지 상하 위치 % (기본: 채우기 0 · 맞추기 50)
  // 코드 블록 전용
  code?:          string;                   // ← 코드 내용
  codeLanguage?:  string;                    // ← 언어 이름 (표시용)
  codeTitle?:     string;                    // ← 머리줄 제목
  codeCollapsed?: boolean;                   // ← 접힘 (제목 줄만 표시)
  codeTheme?:     'auto' | 'dark' | 'light'; // ← 테마 (기본 자동 = 화면 모드 따라감)
  codeFontSize?:  number;                    // ← 글자 크기 px (12 | 13 | 15, 기본 13)
  codeLineNumbers?: boolean;                 // ← 줄 번호 표시
  // 목록·콜아웃·페이지 전용
  blocks?:        BlockItem[];               // ← 블록 목록 (목록·콜아웃 본문, 페이지 본문)
  blockIcon?:     string;                    // ← 콜아웃·페이지 아이콘 (이모지)
  autoEdit?:      boolean;                   // ← 막 만든 노드 — 바로 편집(페이지는 모달 열기) 후 지움
  // DB 테이블(entity) 전용 — 테이블 이름은 title
  columns?:      EntityColumn[];             // ← 컬럼 목록 (높이는 컬럼 수로 정해짐)
  // 표(table) 전용
  tableRows?:    number;                   // ← 행 개수
  tableCols?:    number;                     // ← 열 개수
  tableCells?:   string[][];                 // ← 셀 텍스트 (행x열)
  tableHeaderRow?: boolean;                  // ← 첫 행을 헤더로 강조
  tableColWidths?: number[];                 // ← 열 너비 % (열 수와 같을 때만 씀, 없으면 똑같이 나눔)
  tableCellMeta?: Record<string, { colSpan?: number; rowSpan?: number; hidden?: boolean }>;
  tableSelectedCells?: string[];             // ← 선택된 셀 키 목록 ("r-c")
  tableCellBgColors?: Record<string, string>; // ← 셀별 배경 색상 ("r-c" → color)
  tableCellAligns?: Record<string, 'left' | 'center' | 'right'>; // ← 셀별 텍스트 정렬
  // 종이 규격 프레임 전용
  isPaperFrame?: boolean;                    // ← 리사이즈 시 비율 유지
  pageNumber?:   number;                     // ← 슬라이드 순서 키 (화면 번호는 utils/slides의 순서로 1,2,3…)
  paperSize?:    string;                     // ← 종이 규격 이름 (A4 등) — 프레임 이름과 따로
  // 문서 작업 템플릿 전용
  isDocContainer?: boolean;                  // ← 문서 컨테이너 프레임
  isDocPage?:      boolean;                  // ← A4 페이지 프레임
  docRows?:        number;                   // ← 문서 행 수
  docCols?:        number;                   // ← 문서 열 수
  docRow?:         number;                   // ← 페이지 행 인덱스
  docCol?:         number;                   // ← 페이지 열 인덱스
  docColsPerRow?:  number[];                 // ← 행별 열 수 배열 (컨테이너 전용)
  docMarginTop?:   number;                   // ← 쪽 위 여백 (mm, 기본 20)
  docMarginBottom?:number;                   // ← 쪽 아래 여백 (mm, 기본 20)
  docMarginLeft?:  number;                   // ← 쪽 왼쪽 여백 (mm, 기본 25)
  docMarginRight?: number;                   // ← 쪽 오른쪽 여백 (mm, 기본 25)
  docPageText?:    string;                   // ← 페이지 텍스트 내용
  docFontFamily?:  string;                   // ← 페이지 기본 글꼴 키 (utils/docPageEditor DOC_FONTS, 기본 pretendard)
  docPageHtml?:    string;                  // ← 같은 내용의 서식(글자별 색) 버전 — docPageText와 맞을 때만 사용
  textAlignTop?:   boolean;                  // ← 텍스트 상단 정렬 (문서용)
  textAlignH?:     'left' | 'center' | 'right';   // ← 도형 안 글씨 가로 정렬 (기본 가운데)
  textAlignV?:     'top' | 'middle' | 'bottom';   // ← 도형 안 글씨 세로 정렬 (기본 가운데)
  docTemplateContent?: DocTemplateContent;    // ← 템플릿 요소별 스타일 오버라이드
  [key: string]: unknown;                    // ← 추가 속성도 자유롭게 넣을 수 있음
}

// 앱 전체에서 사용하는 노드 타입
export type AppNode = RFNode<NodeData, 'custom'>;
//                     ↑ React Flow 노드 + NodeData 구조를 합친 타입

// 엣지의 커스텀 데이터 (화살표 방향, 선 색상)
// Record<string, unknown>을 extends해야 React Flow Edge 제약 충족
export interface EdgeData extends Record<string, unknown> {
  arrowType?: 'none' | 'end' | 'start' | 'both'; // 화살표 방향
  strokeColor?: string;                            // 선 색상 (UI 복원용)
  labelFontSize?: number;                          // 라벨 글씨 크기(px)
  labelColor?: string;                             // 라벨 글씨 색상
  labelBgColor?: string;                           // 라벨 배경 색상
  labelBorderColor?: string;                       // 라벨 윤곽선 색상
  lineShape?: 'curve';
  stepOffset?: number;                             // 꺾은선이 도형에서 나가 꺾이기까지 거리(px, 기본 24) — 돌아가는 선끼리 겹치지 않게
  freeLineType?: 'straight' | 'step' | 'default';  // 자유 화살표 모양 — 직선 / 꺾은선 / 곡선 (없으면 직선)
  labelWidth?: number;                             // 라벨 박스 너비 — 없으면 글자에 맞춤
  labelHeight?: number;                            // 라벨 박스 높이 — 없으면 글자에 맞춤                             // 라벨 연결선 모양 — 'curve'면 곡선, 없으면 꺾는선
}

// 앱 전체에서 사용하는 엣지 타입
export type AppEdge = RFEdge<EdgeData>;
//                     ↑ React Flow 기본 엣지 + 커스텀 EdgeData

// ── 도구 & 엣지 옵션 ─────────────────────────────────────────
export type ToolType     = 'select' | 'hand' | 'connect';
//                          ↑ 캔버스 도구 (선택/손/연결 3가지)

export type EdgeStyle    = 'solid' | 'dashed';
//                          ↑ 선의 스타일 (실선/점선)

export type EdgeLineType = 'default' | 'straight' | 'step' | 'smoothstep' | 'elbow';
//                          ↑ 선의 모양 (4가지 곡선 옵션)

// ── 기존 호환용 ──────────────────────────────────────────────
export interface ThemeMode {
  isDark: boolean;         // ← 다크모드 여부 (true/false)
}

export interface SidebarState {
  leftCollapsed:  boolean; // ← 왼쪽 사이드바가 접혔는지 여부
  rightCollapsed: boolean; // ← 오른쪽 사이드바가 접혔는지 여부
}

// ── 문서 템플릿 요소 스타일 ──────────────────────────────────
export interface DocTemplateElementStyle {
  fontSize?:    number;
  fontWeight?:  'normal' | 'bold';
  fontStyle?:   'normal' | 'italic';
  color?:       string;
  background?:  string;
  borderColor?: string;
  borderRadius?: number;
  opacity?:     number;   // 0~100
  content?:     string;
  dx?:          number;   // 드래그 이동 X 오프셋 (template 내 상대좌표)
  dy?:          number;   // 드래그 이동 Y 오프셋
  imageUrl?:    string;   // base64 또는 URL (이미지 슬롯 전용)
}

export interface DocTemplateContent {
  [elementId: string]: DocTemplateElementStyle;
}
