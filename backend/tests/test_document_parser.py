import zipfile

import pytest
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject


def write_pdf(path, text=True):
    writer = PdfWriter()
    page = writer.add_blank_page(width=500, height=500)
    if text:
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 12 Tf 50 400 Td (Learning concepts and practice.) Tj ET')
        page[NameObject('/Contents')] = writer._add_object(stream)
    writer.write(path)


@pytest.mark.parametrize('extension', ['.txt','.md','.docx','.pdf'])
async def test_supported_documents_parse_in_a_worker_and_release_upload(tmp_path, extension):
    from app.services.document_parser import parse_upload
    path = tmp_path / ('course' + extension)
    if extension == '.pdf':
        write_pdf(path)
    elif extension == '.docx':
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文课程与练习</w:t></w:r></w:p></w:body></w:document>')
    else:
        path.write_text('中文课程介绍。\n分块保留资料内容。' * 100, encoding='utf-8-sig')
    chunks = await parse_upload(path, chunk_size=1000, overlap=150, timeout=30)
    assert chunks and all(chunk.text.strip() for chunk in chunks)
    assert chunks[0].page == (1 if extension == '.pdf' else None)
    assert all(len(chunk.text) <= 1000 for chunk in chunks)
    assert not path.exists() and not list(tmp_path.glob('*.jsonl'))


@pytest.mark.parametrize('kind', ['scanned','corrupt','encoding'])
async def test_unreadable_document_fails_without_leaving_temp_content(tmp_path, kind):
    from app.services.document_parser import parse_upload, DocumentParseError
    path = tmp_path / ('file.txt' if kind == 'encoding' else 'file.pdf')
    if kind == 'scanned':
        write_pdf(path, text=False)
    else:
        path.write_bytes(b'\xff\xfe\x00broken')
    with pytest.raises(DocumentParseError):
        await parse_upload(path, chunk_size=1000, overlap=150, timeout=30)
    assert not list(tmp_path.iterdir())


async def test_processing_deadline_terminates_parser_and_cleans_files(tmp_path):
    from app.services.document_parser import parse_upload
    path = tmp_path / 'file.txt'
    path.write_text('Chinese learning content', encoding='utf-8')
    with pytest.raises(TimeoutError):
        await parse_upload(path, chunk_size=1000, overlap=150, timeout=0.001)
    assert not list(tmp_path.iterdir())
