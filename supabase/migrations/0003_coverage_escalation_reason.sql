-- Why Ivy couldn't verify the insurance (her own reasoning). Null unless coverage_status = 'ESCALATED' (not claimed, full bill).
alter table visits add column if not exists coverage_escalation_reason text;
