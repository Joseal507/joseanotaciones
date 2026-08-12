import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '../../../../../lib/auth/options'
import { getMaterial } from '../../../../../lib/materials/repository'
import { downloadFromR2 } from '../../../../../lib/materials/storage'
import { renderPdfPagePng } from '../../../../../lib/materials/pdfPageAsset'

export async function GET(req:NextRequest,{params}:{params:{id:string}}){
  const session=await getServerSession(authOptions)
  const userId=(session?.user as {id?:string}|undefined)?.id
  if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
  const page=Number(req.nextUrl.searchParams.get('page'))
  try{
    const material=await getMaterial(params.id,userId)
    if(!material?.storage_key)return NextResponse.json({error:'Material not found'},{status:404})
    const buffer=await downloadFromR2(material.storage_key)
    const png=await renderPdfPagePng(buffer,page)
    return new NextResponse(new Uint8Array(png),{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=86400, stale-while-revalidate=604800','X-Content-Type-Options':'nosniff'}})
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Page render failed'},{status:422})}
}
