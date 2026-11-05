import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
export default function MathText({children,className='',inline=false}){const Wrapper=inline?'span':'div';return <Wrapper className={`math-text ${inline?'inline':''} ${className}`}><ReactMarkdown components={{...(inline?{p:'span'}:{}),img:()=>null,a:({children,href})=><a href={href} target="_blank" rel="noreferrer">{children}</a>}} remarkPlugins={[remarkMath,remarkBreaks]} rehypePlugins={[[rehypeKatex,{throwOnError:false,strict:false,trust:false}]]}>{String(children||'')}</ReactMarkdown></Wrapper>;}
