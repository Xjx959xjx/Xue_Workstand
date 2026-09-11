import pathlib,json,subprocess,urllib.request
root=pathlib.Path('outputs/cf-source-review')
for key in ['6M2sWFbQxys','LTx3dUErYHM','1MEj5pEf1N4','9S2w0-7KEUY','yGYOtodvxRg','Tu6BATa1mSQ','t0qghgA9neo']:
 p=root/(key+'.json')
 if not p.exists():continue
 d=json.loads(p.read_text()); urls=d.get('mediaUrls',[])
 for u in urls:
  if 'douyinvod.com' not in u:continue
  try:
   req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.douyin.com/'})
   with urllib.request.urlopen(req,timeout=40) as r: data=r.read()
   dest=root/(key+'.mp4');dest.write_bytes(data)
   duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(dest)]))
   subprocess.run(['ffmpeg','-v','error','-i',str(dest),'-vf',f'fps=9/{duration},scale=480:-1,tile=3x3','-frames:v','1','-y',str(root/(key+'-frames.jpg'))],check=True,capture_output=True)
   print(key,'frames OK',duration,flush=True);break
  except Exception as e:print(key,type(e).__name__,flush=True)
