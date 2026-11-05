import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readableFilename } from './filename.js';
import { chapters, groupKey, errorTypes } from './taxonomy.js';
import { AppError, extractionSchema, analysisSchema, exerciseSchema, verificationSchema, gradeSchema, prompts } from './model.js';

const safeText=z.string().trim().min(1).max(18000);
export function createApp({store,model}){
  const app=express();app.disable('x-powered-by');
  app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');res.set('Cache-Control','no-store');
    if(req.method!=='GET'&&req.method!=='HEAD'){
      const origin=req.get('origin');if(origin&&origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'请从本网站页面操作。'});
      if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'不支持跨站请求。'});
    }next();
  });
  app.use(express.json({limit:'1mb'}));
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024,files:10}});
  const busy=new Set();
  const get=(id,kind)=>{const item=store.get(id);if(!item||item.kind!==kind)throw new AppError('记录不存在。',404);return item;};
  const guard=async(id,fn)=>{if(busy.has(id))throw new AppError('这道题正在处理，请稍候。',409);busy.add(id);try{return await fn();}finally{busy.delete(id);}};
  const safeExercise=(item)=>{const {answer,solution,...safe}=item;return {...safe,has_solution:true};};
  const safeAttempt=(item)=>({...item});
  const safeQuestion=(item)=>({...item,original_name:readableFilename(item.original_name),busy:busy.has(item.id)});
  const savePhoto=async(file)=>{if(!file)throw new AppError('请选择一张照片。');let bytes;try{const pipeline=sharp(file.buffer,{limitInputPixels:40000000});const metadata=await pipeline.metadata();if(!['jpeg','png','webp'].includes(metadata.format))throw new Error('unsupported');bytes=await pipeline.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer();}catch{throw new AppError('无法读取图片，请使用清晰的 JPG、PNG 或 WebP 照片。');}const name=`${randomUUID()}.jpg`;await writeFile(path.join(store.dir,'photos',name),bytes);return name;};
  const photo=(name)=>readFile(path.join(store.dir,'photos',name));
  const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
  const persistError=async(item,fn)=>{try{const r=await fn();return r;}catch(e){item.last_error=e.message;store.save(item);throw e;}};
  app.get('/api/status',(_req,res)=>res.json({configured:model.configured,model:model.name,storage:'本机 SQLite',chapters,error_types:errorTypes}));
  app.get('/api/questions',(_req,res)=>res.json(store.list('question').map(safeQuestion)));
  app.post('/api/questions',upload.array('photos',10),handle(async(req,res)=>{
    const mode=z.enum(['auto','question','solution']).parse(req.body.mode||'auto');if(!req.files?.length)throw new AppError('请至少选择一张照片。');
    const items=[],failed=[];
    for(const file of req.files){try{const filename=await savePhoto(file);items.push(store.create('question',{filename,original_name:readableFilename(file.originalname),mode,status:'uploaded',question:'',student_work:'',warnings:[],last_error:null,analysis:null,reviewed_at:null}));}catch(e){failed.push({name:file.originalname,error:e.message});}}
    res.status(items.length?201:400).json({items,failed,...(!items.length?{error:'没有可保存的图片，请检查格式。'}:{})});
  }));
  app.get('/api/questions/:id',handle(async(req,res)=>res.json(safeQuestion(get(req.params.id,'question')))));
  app.get('/api/photos/:id',handle(async(req,res)=>{const item=store.get(req.params.id);if(!item?.filename)throw new AppError('照片不存在。',404);res.type('jpg').send(await photo(item.filename));}));
  app.post('/api/questions/:id/extract',handle(async(req,res)=>{
    const q=get(req.params.id,'question');if(q.status==='archived')throw new AppError('已归档题目无需重新识别。');
    const result=await guard(q.id,()=>persistError(q,async()=>{const extraction=await model.call(prompts.extract(q.mode),extractionSchema,await photo(q.filename));
      if(q.mode==='question'){extraction.student_work='';extraction.has_work=false;}
      Object.assign(q,extraction,{status:'review',reviewed_at:null,last_error:null});store.save(q);return q;}));res.json(result);
  }));
  app.patch('/api/questions/:id/review',handle(async(req,res)=>{
    const q=get(req.params.id,'question');if(busy.has(q.id))throw new AppError('正在处理，请稍候。',409);if(q.status==='archived')throw new AppError('该题已分析归档。');
    const body=z.object({question:safeText,student_work:z.string().max(18000),confirmed:z.literal(true)}).parse(req.body);
    Object.assign(q,{question:body.question,student_work:body.student_work.trim(),has_work:Boolean(body.student_work.trim()),status:'ready',reviewed_at:new Date().toISOString(),needs_confirmation:false,last_error:null});store.save(q);res.json(q);
  }));
  app.post('/api/questions/:id/analyze',handle(async(req,res)=>{
    const q=get(req.params.id,'question');if(q.status==='archived')return res.json(q);if(!q.reviewed_at||!q.question.trim())throw new AppError('请先核对题干与作答，确认后再分析。');
    const result=await guard(q.id,()=>persistError(q,async()=>{const analysis=await model.call(prompts.analyze(q.question,q.student_work),analysisSchema,await photo(q.filename));
      if(!chapters[analysis.chapter].includes(analysis.topic))throw new AppError('AI 返回的知识点不在目录中，请重试。',502);
      if(!q.has_work)analysis.errors=[];
      Object.assign(q,{analysis,status:analysis.needs_confirmation?'ready':'archived',last_error:null});store.save(q);return q;}));res.json(result);
  }));
  app.patch('/api/questions/:id/category',handle(async(req,res)=>{
    const q=get(req.params.id,'question');if(!q.analysis)throw new AppError('请先完成分析。');if(busy.has(q.id))throw new AppError('正在处理，请稍候。',409);
    const {chapter,topic}=z.object({chapter:z.enum(Object.keys(chapters)),topic:z.string().min(1).max(100)}).parse(req.body);if(!chapters[chapter].includes(topic))throw new AppError('请选择目录中的知识点。');q.analysis.chapter=chapter;q.analysis.topic=topic;store.save(q);res.json(q);
  }));
  app.delete('/api/questions/:id',handle(async(req,res)=>{
    const q=get(req.params.id,'question');const exercises=store.list('exercise').filter(e=>e.question_id===q.id);const attempts=store.list('attempt').filter(a=>exercises.some(e=>e.id===a.exercise_id));
    if([q,...exercises,...attempts].some(i=>busy.has(i.id)))throw new AppError('相关内容正在处理，请稍后再删除。',409);
    const records=[q,...exercises,...attempts];store.db.exec('BEGIN');try{for(const item of records)store.db.prepare('DELETE FROM records WHERE id=?').run(item.id);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
    for(const item of records)if(item.filename)await unlink(path.join(store.dir,'photos',item.filename)).catch(()=>{});res.json({ok:true});
  }));
  app.post('/api/questions/:id/exercises',handle(async(req,res)=>{
    const q=get(req.params.id,'question');if(q.status!=='archived')throw new AppError('请先完成原题分析。');const existing=store.list('exercise').filter(e=>e.question_id===q.id);if(existing.length)return res.json(existing.map(safeExercise));
    const result=await guard(q.id,async()=>{const generated=await model.call(prompts.exercises({question:q.question,analysis:q.analysis}),exerciseSchema);const verified=await model.call(prompts.verify(generated.exercises),verificationSchema);
      const indices=new Set(verified.results.map(r=>r.index));if(indices.size!==3||verified.results.some(r=>!r.valid))throw new AppError('本次生成的题目未通过 AI 复核，请重新生成。尚未加入练习。',502);
      let items;const batch_at=new Date().toISOString();store.db.exec('BEGIN');try{items=generated.exercises.map((e,exercise_order)=>store.create('exercise',{...e,target_error:errorTypes.includes(e.target_error)&&q.analysis.errors.some(x=>x.type===e.target_error)?e.target_error:'',question_id:q.id,chapter:q.analysis.chapter,topic:q.analysis.topic,status:'todo',batch_at,exercise_order,verification:'AI 已复核，仍可能有误'}));store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}return items.map(safeExercise);});res.status(201).json(result);
  }));
  app.get('/api/exercises',(_req,res)=>{const attempts=store.list('attempt');res.json(store.list('exercise').sort((a,b)=>(b.batch_at||b.created_at).localeCompare(a.batch_at||a.created_at)||(a.exercise_order??0)-(b.exercise_order??0)).map(e=>({...safeExercise(e),attempts:attempts.filter(a=>a.exercise_id===e.id).map(safeAttempt)})));});
  app.get('/api/exercises/:id/solution',handle(async(req,res)=>{const e=get(req.params.id,'exercise');res.json({answer:e.answer,solution:e.solution});}));
  app.post('/api/exercises/:id/attempts',upload.single('photo'),handle(async(req,res)=>{const e=get(req.params.id,'exercise');const filename=await savePhoto(req.file);const item=store.create('attempt',{filename,exercise_id:e.id,status:'uploaded',student_work:'',grade:null,warnings:[],reviewed_at:null,last_error:null});res.status(201).json(item);}));
  app.post('/api/attempts/:id/extract',handle(async(req,res)=>{const a=get(req.params.id,'attempt');if(a.grade)throw new AppError('该次作答已批改。');const result=await guard(a.id,()=>persistError(a,async()=>{const out=await model.call(prompts.extract('solution',true),extractionSchema,await photo(a.filename));Object.assign(a,{student_work:out.student_work||out.question,warnings:out.warnings,status:'review',reviewed_at:null,last_error:null});store.save(a);return a;}));res.json(result);}));
  app.patch('/api/attempts/:id/review',handle(async(req,res)=>{const a=get(req.params.id,'attempt');if(a.grade)throw new AppError('该次作答已批改，请重新上传新的作答。');if(busy.has(a.id))throw new AppError('正在处理，请稍候。',409);const body=z.object({student_work:safeText,confirmed:z.literal(true)}).parse(req.body);Object.assign(a,{student_work:body.student_work,status:'ready',reviewed_at:new Date().toISOString(),last_error:null});store.save(a);res.json(a);}));
  app.post('/api/attempts/:id/grade',handle(async(req,res)=>{const a=get(req.params.id,'attempt');if(a.grade)return res.json(a);if(!a.reviewed_at)throw new AppError('请先核对作答内容。');const e=get(a.exercise_id,'exercise');const q=get(e.question_id,'question');const result=await guard(a.id,()=>persistError(a,async()=>{const grade=await model.call(prompts.grade({question:e.question,answer:e.answer,solution:e.solution},a.student_work),gradeSchema,await photo(a.filename));
      const recurrence=grade.verdict==='uncertain'?[]:[...new Set(grade.errors.filter(x=>q.analysis.errors.some(o=>o.type===x.type)).map(x=>x.type))];
      Object.assign(a,{grade:{...grade,recurring_errors:recurrence},status:grade.verdict==='uncertain'?'uncertain':'graded',last_error:null});e.status=grade.verdict==='correct'?'correct':grade.verdict==='uncertain'?'uncertain':'retry';
      store.db.exec('BEGIN');try{store.save(a);store.save(e);store.db.exec('COMMIT');}catch(err){store.db.exec('ROLLBACK');throw err;}return a;}));res.json(result);}));
  const documents=()=>{const docs=new Map();for(const q of store.list('question').filter(q=>q.status==='archived')){const a=q.analysis;const key=groupKey(a.chapter,a.topic);if(!docs.has(key))docs.set(key,{name:key,chapter:a.chapter,topic:a.topic,questions:[],key_points:[],groups:{}});const doc=docs.get(key);doc.questions.push(q);doc.key_points.push(...a.key_points);const types=[...new Set(a.errors.map(e=>e.type))];for(const type of types.length?types:[q.has_work?'未发现明确错误':'未提供作答']){doc.groups[type]??=[];doc.groups[type].push(q.id);}}return [...docs.values()].map(d=>({...d,key_points:[...new Set(d.key_points)]}));};
  app.get('/api/documents',(_req,res)=>{const exercises=store.list('exercise'),attempts=store.list('attempt');res.json(documents().map(doc=>({...doc,learning_records:attempts.filter(a=>a.grade&&exercises.some(e=>e.id===a.exercise_id&&doc.questions.some(q=>q.id===e.question_id))).map(a=>{const e=exercises.find(e=>e.id===a.exercise_id);return {id:a.id,created_at:a.created_at,question_id:e.question_id,difficulty:e.difficulty,verdict:a.grade.verdict,recurring_errors:a.grade.recurring_errors,explanation:a.grade.explanation};})})));});
  app.get('/api/documents/export',handle(async(req,res)=>{const doc=documents().find(d=>d.name===req.query.name);if(!doc)throw new AppError('文档不存在。',404);const exercises=store.list('exercise');const attempts=store.list('attempt');const lines=[`# ${doc.name}`,'','> 由个人错题整理；AI 分析与练习可能有误，请结合教材和教师讲解核对。','','## 做题要点','',...doc.key_points.map(p=>`- ${p}`)];
    for(const [type,ids]of Object.entries(doc.groups)){lines.push('',`## ${type}`);for(const id of ids){const q=doc.questions.find(q=>q.id===id),a=q.analysis;lines.push('',`### ${a.title}`,'',q.question,'','#### 原作答','',q.student_work||'未提供作答。','','#### 解题思路','',a.approach,'',...a.steps.map((s,i)=>`${i+1}. **${s.title}**\n\n${s.content}\n`),'',`答案：${a.answer}`);for(const err of a.errors)lines.push('',`错误步骤：${err.step}`,`\n原文：${err.quote}`,`\n解释：${err.explanation}`,`\n修正：${err.correction}`);for(const e of exercises.filter(e=>e.question_id===q.id)){lines.push('','#### 巩固练习',e.question,'',`参考答案：${e.answer}`,'',e.solution);for(const at of attempts.filter(at=>at.exercise_id===e.id&&at.grade))lines.push('','练习作答：',at.student_work,'',`AI 批改：${at.grade.explanation}`,`\n同类错误：${at.grade.recurring_errors.join('、')||'未记录'}`);}}}
    res.set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(doc.name+'.md')}`).type('text/markdown').send(lines.join('\n'));}));
  app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在。'}));
  app.use((err,_req,res,_next)=>{if(err instanceof z.ZodError)return res.status(400).json({error:'提交内容不完整或格式不正确，请检查后再试。'});if(err instanceof multer.MulterError)return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'单张照片不能超过 12 MB。':'一次最多上传 10 张照片，请检查选择的文件。'});res.status(err.status||500).json({error:err.status?err.message:'本地服务遇到问题，请重试。'});});
  return app;
}
