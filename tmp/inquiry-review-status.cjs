const {loadEnvConfig}=require('@next/env');loadEnvConfig(process.cwd());const {Client}=require('pg');
const c=new Client({host:process.env.DB_HOST||'aws-1-ap-northeast-1.pooler.supabase.com',port:Number(process.env.DB_PORT||6543),database:process.env.DB_NAME||'postgres',user:process.env.DB_USER||'postgres.hhftvzockfgigsfonivp',password:process.env.DB_PASSWORD||'',connectionTimeoutMillis:10000});

(async()=>{try{await c.connect();await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='15000ms'");
for(const [label,sql] of [
['reasons',"SELECT status,reason,count(*)::int AS count FROM inquiry_jobs GROUP BY status,reason ORDER BY count(*) DESC"],
['alerts',"SELECT status,error,count(*)::int AS count FROM inquiry_notifications GROUP BY status,error"],
['anon',`SELECT left(g.text,900) AS question,left(h.text,1200) AS following_host_message FROM (SELECT * FROM messages WHERE property_id=(SELECT id FROM properties WHERE name='안온재') AND source='beds24' AND sender='guest' ORDER BY created_at DESC LIMIT 20) g LEFT JOIN LATERAL(SELECT text FROM messages h WHERE h.event_id=g.event_id AND sender='host' AND created_at>g.created_at AND created_at<g.created_at+interval '24 hours' ORDER BY created_at LIMIT 1) h ON true`]
])console.log(label,JSON.stringify((await c.query(sql)).rows).replace(/https?:[^\s"<>]+/g,'[URL]'));await c.query('ROLLBACK');}finally{await c.end();}})().catch(e=>{console.error(e.message);process.exitCode=1});