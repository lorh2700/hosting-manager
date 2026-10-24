import { todayKst } from '@/lib/dates';
export function cleaningCancellationReason(app: { applicantId:string;status:string;role?:string }, cleaning: { cleanerId:string|null;assignmentType:string;assistantCleanerId?:string|null;assistantAssignmentType?:string|null;status:string;date:string;completedAt:Date|null }|null, userId:string, today=todayKst()):string|null {
 if(app.applicantId!==userId)return '본인이 신청한 청소만 취소할 수 있습니다.';
 if(!['pending','approved'].includes(app.status))return '이미 처리된 신청입니다.';
 if(!cleaning)return '청소 일정이 없습니다.';
 if(cleaning.date<=today)return '당일 또는 지난 청소는 관리자에게 문의해 주세요.';
 if(cleaning.status!=='pending'||cleaning.completedAt)return '진행 중이거나 완료된 청소는 취소할 수 없습니다.';
 const assignee=app.role==='assistant'?cleaning.assistantCleanerId:cleaning.cleanerId;
 const assignment=app.role==='assistant'?cleaning.assistantAssignmentType:cleaning.assignmentType;
 if(app.status==='pending'&&!assignee)return null;
 if(assignee!==userId)return '현재 본인에게 배정된 청소가 아닙니다.';
 if(assignment!=='applied')return '관리자가 배정한 청소는 관리자에게 문의해 주세요.';
 return null;
}
