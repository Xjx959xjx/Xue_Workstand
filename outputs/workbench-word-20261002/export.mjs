import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createEngagementDocx} from '../../src/lib/engagement-export.ts';
import {writeJsonFile,writeFileAtomic} from '../../src/lib/storage/fs.ts';
import {parseStoredRecord} from '../../src/lib/storage/schemas.ts';
const root=process.cwd();
process.env.STYLE_LIBRARY_DIR=path.join(root,'outputs/workbench-word-20261002/isolated-library');
for(const [id,dir] of [['run-2de4aaf6ad','comments-120-20261002'],['run-2205fcbabd','kpl-comments-120-20261002']]) {
 const record=JSON.parse(await readFile(path.join(root,'style-library/engagement',id+'.json'),'utf8'));
 const data=JSON.parse(await readFile(path.join(root,'outputs',dir,'result.json'),'utf8'));
 if(data.comments.length!==120||data.sourceUrl!==record.sourceUrl)throw new Error('评论数量或来源不匹配');
 record.comments.items=data.comments.map((text,i)=>({id:'comment-'+(i+1),platform:'douyin',text,origin:'ai_generated'}));
 delete record.danmaku;
 const valid=parseStoredRecord(id,record,'engagement');
 await writeJsonFile(path.join(process.env.STYLE_LIBRARY_DIR,'engagement',id+'.json'),valid);
 const out=await createEngagementDocx(id);
 const target=path.join(root,'outputs/workbench-word-20261002',out.fileName);
 await writeFileAtomic(target,out.buffer);console.log(target);
}
