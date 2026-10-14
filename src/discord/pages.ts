/** Paginate at line boundaries so mentions and numbered queue entries stay intact. */
export function paginateLines(lines:string[],limit=3800):string[]{
  const pages:string[]=[];let current='';
  for(const line of lines){if(line.length>limit)throw new Error('A panel line exceeds its supported limit.');const next=current?current+'\n'+line:line;if(next.length>limit){pages.push(current);current=line;}else current=next;}
  if(current||!pages.length)pages.push(current||'No members listed');return pages;
}
