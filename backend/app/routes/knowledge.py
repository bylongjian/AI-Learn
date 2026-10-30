from fastapi import APIRouter, Depends, Form, Request, UploadFile

from app.core.identity import Identity
from app.routes.user import required_identity, success

router = APIRouter(prefix='/api/v1/knowledge')


@router.post('/documents',status_code=202)
async def upload_document(file: UploadFile, request: Request, identity: Identity=Depends(required_identity),
                          file_name: str | None=Form(default=None,max_length=255)):
    if file_name is not None:
        file.filename = file_name
    doc = await request.app.state.documents.upload(identity.user_id,file)
    return success(doc.model_dump(mode='json'))


@router.get('/documents')
async def list_documents(request: Request,identity: Identity=Depends(required_identity)):
    service = request.app.state.documents
    docs = await service.repository.list(identity.user_id)
    return success({'items':[doc.model_dump(mode='json') for doc in docs],
        'limit':service.settings.kb_max_documents_per_user,'max_file_bytes':service.settings.kb_max_file_size_mb*1024*1024})


@router.get('/documents/{doc_id}')
async def document_status(doc_id: str, request: Request,identity: Identity=Depends(required_identity)):
    doc = await request.app.state.documents.repository.get(identity.user_id,doc_id)
    return success(doc.model_dump(mode='json'))


@router.delete('/documents/{doc_id}',status_code=202)
async def delete_document(doc_id: str,request: Request,identity: Identity=Depends(required_identity)):
    await request.app.state.documents.delete(identity.user_id,doc_id)
    return success({'doc_id':doc_id,'status':'deleting'})
