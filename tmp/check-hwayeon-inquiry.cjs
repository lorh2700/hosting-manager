const {loadEnvConfig}=require('@next/env');loadEnvConfig(process.cwd());const {Client}=require('pg');
const c=new Client({host:process.env.DB_HOST||'aws-1-ap-northeast-1.pooler.supabase.com',port:Number(process.env.DB_PORT||6543),database:process.env.DB_NAME||'postgres',user:process.env.DB_USER||'postgres.hhftvzockfgigsfonivp',password:process.env.DB_PASSWORD||'',connectionTimeoutMillis:10000});

(async()=>{try{await c.connect();await c.query('BEGIN READ ONLY');for(const [label,sql] of [
['recent',"SELECT j.created_at,j.status,j.reason,j.summary,e.source,left(m.text,1100) AS question FROM inquiry_jobs j JOIN properties p ON p.id=j.property_id JOIN messages m ON m.id=j.message_id JOIN events e ON e.id=j.event_id WHERE p.slug='hwayeonjae' ORDER BY j.created_at DESC LIMIT 5"],
['knowledge',"SELECT a.knowledge FROM inquiry_automation_settings a JOIN properties p ON p.id=a.property_id WHERE p.slug='hwayeonjae'"],
['sources',"SELECT source,count(*)::int FROM events WHERE channel_id='beds24' GROUP BY source"]
])console.log(label,JSON.stringify((await c.query(sql)).rows));await c.query('ROLLBACK');}finally{await c.end();}})().catch(e=>{console.error(e.message);process.exitCode=1});