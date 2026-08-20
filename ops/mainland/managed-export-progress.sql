select state, coalesce(wait_event_type, ''), coalesce(wait_event, ''), left(query, 240)
from pg_stat_activity
where application_name = 'pg_dump'
order by backend_start;

select relid::regclass, bytes_processed, tuples_processed
from pg_stat_progress_copy;
