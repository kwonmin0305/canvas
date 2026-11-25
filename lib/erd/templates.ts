// ═══════════════════════════════════════════════════════════
// 📁 lib/erd/templates.ts
// DB 설계 템플릿 — 테이블 목록. 좌표는 buildErd가 계산
//   컬럼 이름은 영어(SQL로 내보낼 수 있게), 설명(note)은 한글
// ═══════════════════════════════════════════════════════════

import type { ErdTableInput, ErdColumnInput } from './index';
import { tr } from '@/lib/i18n';

const id: ErdColumnInput = { name: 'id', type: 'uuid', pk: true };
const createdAt: ErdColumnInput = { name: 'created_at', type: 'timestamptz', note: tr('만든 때', 'Created at'), default: 'now()' };
const col = (name: string, type: string, note: string, extra: Partial<ErdColumnInput> = {}): ErdColumnInput => ({ name, type, note, ...extra });
const ref = (name: string, target: string, note: string, extra: Partial<ErdColumnInput> = {}): ErdColumnInput =>
  ({ name, type: 'uuid', note, ref: `${target}.id`, ...extra });

const users: ErdTableInput = {
  name: 'users',
  columns: [
    id,
    col('email', 'text', tr('이메일', 'Email'), { unique: true }),
    col('name', 'text', tr('이름', 'Name')),
    col('avatar_url', 'text', tr('프로필 사진', 'Profile photo'), { nullable: true }),
    createdAt,
  ],
};

export interface ErdTemplate { key: string; label: string; title: string; keywords: string; tables: ErdTableInput[] }

export const ERD_TEMPLATES: ErdTemplate[] = [
  {
    key: 'auth', get label() { return tr('회원·로그인 DB', 'Users & login DB'); }, get title() { return tr('회원·로그인', 'Users & login'); }, keywords: 'user auth login 회원 로그인 가입',
    tables: [
      users,
      { name: 'profiles', columns: [
        id, ref('user_id', 'users', tr('회원', 'Member'), { unique: true }),
        col('bio', 'text', tr('소개', 'Bio'), { nullable: true }), col('phone', 'text', tr('전화번호', 'Phone number'), { nullable: true }),
      ] },
      { name: 'sessions', columns: [
        id, ref('user_id', 'users', tr('회원', 'Member')),
        col('device', 'text', tr('기기', 'Device'), { nullable: true }), col('expires_at', 'timestamptz', tr('끝나는 때', 'Expires at')), createdAt,
      ] },
    ],
  },
  {
    key: 'shop', get label() { return tr('쇼핑몰 DB', 'Online store DB'); }, get title() { return tr('쇼핑몰', 'Online store'); }, keywords: 'shop store commerce 쇼핑몰 상품 주문 결제',
    tables: [
      users,
      { name: 'categories', columns: [id, col('name', 'text', tr('분류 이름', 'Category name'))] },
      { name: 'products', columns: [
        id, ref('category_id', 'categories', tr('분류', 'Category'), { nullable: true }),
        col('name', 'text', tr('상품 이름', 'Product name')), col('price', 'int', tr('가격', 'Price')), col('stock', 'int', tr('재고', 'Stock'), { default: '0' }),
        col('image_url', 'text', tr('사진', 'Photo'), { nullable: true }), createdAt,
      ] },
      { name: 'orders', columns: [
        id, ref('user_id', 'users', tr('주문한 회원', 'Ordering member')),
        col('status', 'text', tr('주문 상태', 'Order status'), { default: "'pending'" }), col('total', 'int', tr('합계 금액', 'Total amount')), createdAt,
      ] },
      { name: 'order_items', columns: [
        id, ref('order_id', 'orders', tr('주문', 'Order')), ref('product_id', 'products', tr('상품', 'Product')),
        col('quantity', 'int', tr('수량', 'Quantity')), col('price', 'int', tr('살 때 가격', 'Price at purchase')),
      ] },
      { name: 'payments', columns: [
        id, ref('order_id', 'orders', tr('주문', 'Order'), { unique: true }),
        col('method', 'text', tr('결제 수단', 'Payment method')), col('amount', 'int', tr('결제 금액', 'Amount paid')), col('paid_at', 'timestamptz', tr('결제한 때', 'Paid at'), { nullable: true }),
      ] },
    ],
  },
  {
    key: 'board', get label() { return tr('게시판 DB', 'Message board DB'); }, get title() { return tr('게시판', 'Message board'); }, keywords: 'board post blog community 게시판 글 댓글 커뮤니티',
    tables: [
      users,
      { name: 'posts', columns: [
        id, ref('user_id', 'users', tr('글쓴이', 'Author')),
        col('title', 'text', tr('제목', 'Title')), col('body', 'text', tr('본문', 'Body')), col('view_count', 'int', tr('조회 수', 'Views'), { default: '0' }), createdAt,
      ] },
      { name: 'comments', columns: [
        id, ref('post_id', 'posts', tr('글', 'Post')), ref('user_id', 'users', tr('글쓴이', 'Author')),
        ref('parent_id', 'comments', tr('답글이면 원래 댓글', 'Parent comment if a reply'), { nullable: true }), col('body', 'text', tr('내용', 'Content')), createdAt,
      ] },
      { name: 'likes', columns: [id, ref('post_id', 'posts', tr('글', 'Post')), ref('user_id', 'users', tr('누른 회원', 'Member who liked')), createdAt] },
    ],
  },
  {
    key: 'booking', get label() { return tr('예약 DB', 'Booking DB'); }, get title() { return tr('예약', 'Booking'); }, keywords: 'booking reservation 예약 일정 매장',
    tables: [
      users,
      { name: 'places', columns: [
        id, col('name', 'text', tr('매장 이름', 'Place name')), col('address', 'text', tr('주소', 'Address'), { nullable: true }), col('open_time', 'text', tr('여는 시간', 'Opening hours'), { nullable: true }),
      ] },
      { name: 'services', columns: [
        id, ref('place_id', 'places', tr('매장', 'Place')), col('name', 'text', tr('서비스 이름', 'Service name')), col('minutes', 'int', tr('걸리는 시간(분)', 'Duration (min)')), col('price', 'int', tr('가격', 'Price')),
      ] },
      { name: 'bookings', columns: [
        id, ref('user_id', 'users', tr('예약한 회원', 'Booking member')), ref('service_id', 'services', tr('서비스', 'Service')),
        col('starts_at', 'timestamptz', tr('시작 시각', 'Starts at')), col('status', 'text', tr('예약 상태', 'Booking status'), { default: "'booked'" }), createdAt,
      ] },
    ],
  },
  {
    key: 'chat', get label() { return tr('채팅 DB', 'Chat DB'); }, get title() { return tr('채팅', 'Chat'); }, keywords: 'chat message 채팅 메시지 대화방',
    tables: [
      users,
      { name: 'rooms', columns: [id, col('name', 'text', tr('대화방 이름', 'Room name'), { nullable: true }), col('is_group', 'bool', tr('단체방 여부', 'Is group chat'), { default: 'false' }), createdAt] },
      { name: 'room_members', columns: [
        id, ref('room_id', 'rooms', tr('대화방', 'Room')), ref('user_id', 'users', tr('회원', 'Member')), col('last_read_at', 'timestamptz', tr('마지막으로 읽은 때', 'Last read at'), { nullable: true }),
      ] },
      { name: 'messages', columns: [
        id, ref('room_id', 'rooms', tr('대화방', 'Room')), ref('user_id', 'users', tr('보낸 회원', 'Sender')), col('body', 'text', tr('내용', 'Content')), createdAt,
      ] },
    ],
  },
];
