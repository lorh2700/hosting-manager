# 회원관리 기능 기획 플랜

## 목표

호스트 회원과 일반 회원(청소 담당자)의 역할을 명확히 구분하고, 일반 회원은 청소 관련 업무에만 접근할 수 있도록 권한을 체계화한다.

---

## 현재 상태 (이미 구현된 것)

프로젝트에 회원 관리 기반이 이미 상당 부분 갖춰져 있다.

| 기능 | 상태 | 설명 |
|------|:---:|------|
| 역할 타입 정의 | ✅ | super_admin, admin, host, cleaner, viewer |
| Firestore users 컬렉션 | ✅ | role, status, propertyIds 등 |
| 초대 기반 온보딩 | ✅ | 초대 링크 생성 → 수락 → 역할 자동 적용 |
| 사용자 목록/관리 UI | ✅ | /admin/users에서 역할 변경, 숙소 접근 권한 설정 |
| 청소담당자 등록 | ✅ | /admin/cleaners에서 담당자 추가/수정/삭제 |
| 청소담당자 전용 페이지 | ✅ | /cleaner에서 배정된 일정 조회 |
| 역할 기반 라우트 분리 | ✅ | /admin (호스트), /cleaner (청소) |
| 청소 완료 보고 | ❌ | /cleaner에서 읽기만 가능, 상태 업데이트 불가 |
| 필요 비품 등록 | ❌ | 청소담당자가 직접 비품 요청하는 기능 없음 |
| 청소 일정 관리 | ⚠️ | 기본 구조만 있음, 세부 관리 UI 미완성 |

---

## 역할 체계 재정리

### 현재 역할 5개 → 실질적으로 2그룹으로 운영

```
┌─────────────────────────────────────────────────┐
│  호스트 그룹 (모든 권한)                         │
│                                                  │
│  super_admin : 시스템 전체 관리자 (doyoung)      │
│  admin       : 공동 운영자 (동일 권한)           │
│  host        : 숙소 소유자 (특정 숙소만)         │
├─────────────────────────────────────────────────┤
│  일반 회원 그룹 (청소 관련만)                    │
│                                                  │
│  cleaner     : 청소 담당자                       │
│  viewer      : 열람만 가능 (추후 활용)           │
└─────────────────────────────────────────────────┘
```

### 권한 매트릭스

| 기능 | super_admin | admin | host | cleaner | viewer |
|------|:---:|:---:|:---:|:---:|:---:|
| **대시보드** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **예약 관리** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **게스트 관리** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **메시지** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **숙소 설정** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **채널 통합** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **사용자 관리** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **청소 일정 생성/배정** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **청소 일정 신청** | ❌ | ❌ | ❌ | ✅ | ❌ |
| **청소 신청 승인/거절** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **청소 일정 조회** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **청소 완료 보고** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **이슈 등록** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **이슈 처리/해결** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **비품 요청 등록** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **비품 요청 승인** | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## 추가 구현이 필요한 기능 (4개)

### 1. 청소 완료 보고 기능

현재 `/cleaner` 페이지에서는 배정된 청소 일정을 보는 것만 가능하다. 청소 완료 보고 기능을 추가한다.

**청소담당자가 할 수 있는 것:**
- 청소 완료 버튼 → status를 'done'으로 변경 + 완료 시간 기록
- 완료 메모 입력 (간단한 특이사항)
- 완료 사진 첨부 (선택, Firebase Storage)
- 이슈 등록 → 별도의 이슈로 등록 (파손, 고장, 비품 부족 등)

**수정할 파일:**
- `app/cleaner/page.tsx` — 완료 버튼 + 메모 + 이슈 등록 추가
- `lib/types.ts` — Cleaning 타입 확장, CleaningIssue 타입 추가

**Cleaning status 흐름:**
```
pending → done (정상 완료)
        → done + 이슈 등록 (문제 발견 시, 청소는 완료하되 이슈를 별도 기록)
```

**Firestore `cleanings` 컬렉션 필드 추가:**
```typescript
{
  // 기존 필드
  propertyId: string;
  date: string;
  cleanerId: string;
  status: 'pending' | 'done';
  supplies: string[];
  notes: string;

  // 추가 필드
  completedAt?: string;     // 청소 완료 시간
  completionNote?: string;  // 완료 시 메모
  photos?: string[];        // 완료 사진 URL (Firebase Storage)
  reportedBy?: string;      // 보고자 UID
  hasIssue?: boolean;       // 이슈 등록 여부
}
```

**Firestore 새 컬렉션: `cleaning_issues`**
```typescript
{
  id: string;
  cleaningId: string;       // 관련 청소 일정 ID
  propertyId: string;
  reportedBy: string;       // 보고자 UID (cleaner)
  reportedByName: string;
  category: 'damage' | 'malfunction' | 'missing_item' | 'hygiene' | 'other';
  // damage: 파손 (가구, 벽, 바닥 등)
  // malfunction: 고장 (도어락, 보일러, 에어컨 등)
  // missing_item: 분실/부족 (수건, 리모컨 등)
  // hygiene: 위생 문제 (곰팡이, 해충 등)
  // other: 기타
  title: string;            // 이슈 요약 (예: "거실 창문 균열")
  description: string;      // 상세 설명
  photos?: string[];        // 사진 증거
  urgency: 'low' | 'normal' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  resolvedBy?: string;      // 처리자 UID
  resolvedAt?: string;
  resolvedNote?: string;    // 처리 내용
  createdAt: string;
}
```

### 2. 필요 비품 등록/요청 기능

청소담당자가 비품이 부족하거나 필요한 물품을 호스트에게 요청할 수 있는 기능.

**청소담당자가 할 수 있는 것:**
- 비품 요청 등록 (품목명, 수량, 긴급도, 숙소)
- 자신의 요청 내역 조회
- 요청 상태 확인 (대기/승인/완료)

**호스트가 할 수 있는 것:**
- 전체 비품 요청 목록 조회
- 요청 승인/거절
- 처리 완료 표시

**새로 만들 파일:**
- `app/cleaner/supplies/page.tsx` — 청소담당자용 비품 요청 페이지
- `app/admin/supplies/page.tsx` — 호스트용 비품 관리 페이지

**Firestore 새 컬렉션: `supply_requests`**
```typescript
{
  id: string;
  propertyId: string;
  requestedBy: string;      // 요청자 UID (cleaner)
  requestedByName: string;  // 요청자 이름
  items: {
    name: string;           // 품목명 (예: 수건, 샴푸, 쓰레기봉투)
    quantity: number;
    note?: string;          // 비고
  }[];
  urgency: 'low' | 'normal' | 'urgent';
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  statusNote?: string;      // 호스트 메모 (거절 사유 등)
  processedBy?: string;     // 처리자 UID
  processedAt?: string;
  createdAt: string;
}
```

### 3. 청소 일정 신청/승인 기능

청소 담당자가 비어있는 일정에 직접 신청하고, 매니저(호스트)가 승인하는 구조.

**전체 흐름:**
```
호스트: 체크아웃 기반으로 청소 일정 생성 (담당자 미배정 상태)
                    ↓
Cleaner: /cleaner/schedule에서 비어있는 일정 확인
                    ↓
Cleaner: "신청" 버튼 클릭 → 신청 상태로 변경
                    ↓
호스트: /admin/cleanup에서 신청 내역 확인
                    ↓
호스트: 승인 → cleanerId 배정 완료 / 거절 → 사유 메모
                    ↓
Cleaner: 알림 확인 (승인/거절 결과)
```

**청소담당자가 할 수 있는 것:**
- 비어있는(미배정) 청소 일정 목록 조회
- 원하는 일정에 신청 (한 줄 메모 가능, 예: "오전에 가능합니다")
- 자신의 신청 내역/상태 확인
- 승인된 일정 조회

**호스트가 할 수 있는 것:**
- 체크아웃 예약 기반으로 청소 일정 생성 (담당자 미배정)
- 직접 담당자 배정 (기존 방식도 유지)
- 신청 내역 확인 → 승인/거절
- 한 일정에 여러 명이 신청한 경우 선택
- 청소 완료 현황 대시보드

**Firestore `cleanings` 컬렉션 필드 추가:**
```typescript
{
  // 기존 필드
  propertyId: string;
  date: string;
  cleanerId?: string;        // null이면 미배정 (신청 가능)
  status: 'pending' | 'done';

  // 일정 신청 관련 추가 필드
  assignmentType?: 'direct' | 'applied';  // 직접 배정 vs 신청 후 승인
  isOpen?: boolean;          // true면 신청 가능한 빈 일정
}
```

**Firestore 새 컬렉션: `cleaning_applications`**
```typescript
{
  id: string;
  cleaningId: string;        // 신청 대상 청소 일정 ID
  propertyId: string;
  applicantId: string;       // 신청자 UID (cleaner)
  applicantName: string;
  note?: string;             // 신청 메모 ("오전 가능", "오후 2시 이후 가능" 등)
  status: 'pending' | 'approved' | 'rejected';
  rejectedReason?: string;   // 거절 사유
  processedBy?: string;      // 처리자 UID (호스트)
  processedAt?: string;
  createdAt: string;
}
```

**승인 시 자동 처리:**
- cleaning_applications 상태 → 'approved'
- cleanings 문서의 cleanerId → 승인된 신청자 UID로 업데이트
- cleanings 문서의 isOpen → false
- 같은 일정의 다른 신청 → 자동 'rejected' (사유: "다른 담당자가 배정되었습니다")

**수정할 파일:**
- `app/admin/cleanup/page.tsx` — 일정 생성(미배정) + 신청 내역 확인/승인 UI
- `app/cleaner/schedule/page.tsx` — 빈 일정 목록 + 신청 버튼
- `lib/types.ts` — CleaningApplication 타입 추가

### 4. 청소 일정 자동 생성

체크아웃 예약이 있으면 자동으로 청소 일정을 생성한다 (미배정 상태로).

**동작 방식:**
- 예약 동기화 시 체크아웃 날짜에 해당하는 청소 일정 자동 생성
- cleanerId 비워둠 (isOpen: true)
- 청소 담당자들이 신청할 수 있는 상태

**수정할 파일:**
- 예약 동기화 로직에 청소 일정 자동 생성 추가

### 4. Cleaner 전용 네비게이션 & 대시보드

현재 `/cleaner` 페이지가 단일 페이지인데, 하위 메뉴를 추가한다.

**Cleaner 페이지 구조:**
```
/cleaner
  ├── /              (오늘의 청소 일정 대시보드 + 완료 보고)
  ├── /schedule      (전체 일정 + 빈 일정 신청)
  ├── /issues        (이슈 등록/내역)
  ├── /supplies      (비품 요청)
  └── /history       (지난 청소 기록)
```

**수정할 파일:**
- `app/cleaner/layout.tsx` — 하단 네비게이션 추가
- `app/cleaner/page.tsx` — 오늘의 일정 중심 대시보드 + 완료 버튼

**신규 파일:**
- `app/cleaner/schedule/page.tsx` — 주간/월간 일정 뷰
- `app/cleaner/issues/page.tsx` — 이슈 등록 및 내역 조회
- `app/cleaner/supplies/page.tsx` — 비품 요청
- `app/cleaner/history/page.tsx` — 지난 기록
- `app/admin/issues/page.tsx` — 호스트용 이슈 관리 (전체 조회, 처리)

---

## 수정이 필요 없는 것 (이미 잘 되어 있음)

- **역할 타입 정의** — super_admin, admin, host, cleaner, viewer 이미 있음
- **초대 시스템** — 초대 링크 생성 → 수락 → 역할 자동 적용 완성
- **사용자 관리 UI** — /admin/users에서 역할 변경, 숙소 접근 권한 설정 가능
- **라우트 분리** — /admin (호스트), /cleaner (청소) 이미 분리
- **FirebaseProvider** — 인증, 프로필, 초대 적용 모두 완성
- **청소담당자 등록** — /admin/cleaners에서 추가/수정/삭제 가능

---

## Firestore Rules 업데이트 필요

청소담당자가 자신의 청소 기록만 수정할 수 있도록 보안 규칙 추가.

```
// cleanings 컬렉션
match /cleanings/{cleaningId} {
  // 읽기: 해당 숙소에 접근 권한이 있는 사용자
  allow read: if isAuthenticated() && hasPropertyAccess(resource.data.propertyId);

  // 쓰기: 호스트 그룹은 전체, cleaner는 자신에게 배정된 건만 (status, completionNote, photos만)
  allow update: if isAuthenticated() && (
    isHostGroup() ||
    (resource.data.cleanerId == request.auth.uid &&
     onlyUpdatedFields(['status', 'startedAt', 'completedAt', 'completionNote', 'photos', 'reportedBy']))
  );
}

// cleaning_applications 컬렉션
match /cleaning_applications/{appId} {
  // 읽기: 호스트 그룹은 전체, cleaner는 자신의 신청만
  allow read: if isAuthenticated() && (
    isHostGroup() ||
    resource.data.applicantId == request.auth.uid
  );

  // 생성: cleaner만 (본인이 신청자)
  allow create: if isAuthenticated() &&
    request.auth.uid == request.resource.data.applicantId &&
    getUserRole() == 'cleaner';

  // 수정: 호스트 그룹만 (승인/거절)
  allow update: if isAuthenticated() && isHostGroup();
}

// cleaning_issues 컬렉션
match /cleaning_issues/{issueId} {
  // 읽기: 해당 숙소 접근 권한
  allow read: if isAuthenticated() && hasPropertyAccess(resource.data.propertyId);

  // 생성: cleaner 이상 (본인이 보고자)
  allow create: if isAuthenticated() && request.auth.uid == request.resource.data.reportedBy;

  // 수정: 호스트 그룹은 전체, cleaner는 open 상태인 자신의 이슈만
  allow update: if isAuthenticated() && (
    isHostGroup() ||
    (resource.data.reportedBy == request.auth.uid && resource.data.status == 'open')
  );
}

// supply_requests 컬렉션
match /supply_requests/{requestId} {
  // 읽기: 해당 숙소 접근 권한
  allow read: if isAuthenticated() && hasPropertyAccess(resource.data.propertyId);

  // 생성: cleaner 이상
  allow create: if isAuthenticated() && request.auth.uid == request.resource.data.requestedBy;

  // 수정: 호스트 그룹만 (승인/거절)
  allow update: if isAuthenticated() && isHostGroup();
}
```

---

## 구현 우선순위 및 일정

### Phase 1: 청소 완료 보고 + 이슈 등록 (핵심, 반나절)
1. Cleaning 타입 확장, CleaningIssue 타입 추가
2. /cleaner 페이지에 완료 버튼 + 메모 + 이슈 등록 추가
3. /admin/issues 페이지 (이슈 관리)
4. Firestore rules 업데이트

→ 결과: 청소담당자가 완료 보고 + 문제 발견 시 이슈 등록 가능

### Phase 2: 청소 일정 신청/승인 (반나절)
1. CleaningApplication 타입 추가
2. /admin/cleanup에 미배정 일정 생성 + 신청 승인 UI
3. /cleaner/schedule에 빈 일정 조회 + 신청 버튼
4. 승인 시 자동 배정 로직
5. Firestore rules 추가

→ 결과: 빈 일정에 청소담당자가 직접 신청, 호스트가 승인

### Phase 3: 비품 요청 기능 (반나절)
1. supply_requests 컬렉션 및 타입 정의
2. /cleaner/supplies 페이지 (요청 등록/조회)
3. /admin/supplies 페이지 (요청 목록/승인)
4. Firestore rules 추가

→ 결과: 청소담당자가 비품 요청, 호스트가 승인/처리

### Phase 4: Cleaner 대시보드 확장 (반나절)
1. /cleaner 레이아웃에 하단 네비게이션 추가
2. /cleaner/history (지난 기록)

→ 결과: 청소담당자 전용 앱 같은 경험

### Phase 5: 청소 일정 자동 생성 (선택)
1. 체크아웃 예약 기반 자동 청소 일정 생성 (미배정 상태)
2. 담당자들이 알아서 신청하는 셀프서비스 운영 가능

→ 결과: 호스트가 일일이 청소 일정을 만들 필요 없음

---

## 기존 코드 수정 범위

| 파일 | 수정 내용 |
|------|----------|
| `lib/types.ts` | Cleaning 타입 확장, CleaningIssue 타입 추가, SupplyRequest 타입 추가 |
| `app/cleaner/page.tsx` | 청소 완료 보고 버튼/메모 추가 |
| `app/cleaner/layout.tsx` | 하단 네비게이션 추가 |
| `firestore.rules` | cleanings, supply_requests 규칙 추가 |

| 파일 | 신규 생성 |
|------|----------|
| `app/cleaner/issues/page.tsx` | 이슈 등록/내역 페이지 |
| `app/cleaner/supplies/page.tsx` | 비품 요청 페이지 |
| `app/cleaner/schedule/page.tsx` | 일정 캘린더 |
| `app/cleaner/history/page.tsx` | 지난 기록 |
| `app/admin/issues/page.tsx` | 호스트용 이슈 관리 페이지 |
| `app/admin/supplies/page.tsx` | 비품 관리 페이지 |
