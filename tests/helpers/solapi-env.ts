// lib/notify 의 TEMPLATES 는 모듈 로드 시점에 env 를 읽는다. 이 모듈을 '../lib/notify' 보다 먼저 import 한다.
process.env.SOLAPI_API_KEY = 'k';
process.env.SOLAPI_API_SECRET = 's';
process.env.SOLAPI_PFID = 'p';
process.env.SOLAPI_FROM = '01000000000';
process.env.SOLAPI_TPL_CLEANING_OPEN_NEW ??= 'TPL_OPEN_NEW';
