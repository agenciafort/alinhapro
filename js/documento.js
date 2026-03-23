function renderizarMarkdown(md) {
  return marked.parse(md || '');
}

function iniciarEditor(salaId, isAdmin) {
  const docContent = document.getElementById('docContent');
  const docEditor = document.getElementById('docEditor');
  const editorTextarea = document.getElementById('editorTextarea');
  const btnEditar = document.getElementById('btnEditar');
  const btnSalvar = document.getElementById('btnSalvar');
  const btnCancelar = document.getElementById('btnCancelar');

  if (!isAdmin && btnEditar) {
    btnEditar.style.display = 'none';
  }

  if (btnEditar) {
    btnEditar.addEventListener('click', () => {
      docContent.classList.add('doc-content--hidden');
      docEditor.classList.add('doc-editor--active');
      editorTextarea.value = window.__docAtual || '';
      editorTextarea.focus();
    });
  }

  if (btnCancelar) {
    btnCancelar.addEventListener('click', () => {
      docEditor.classList.remove('doc-editor--active');
      docContent.classList.remove('doc-content--hidden');
    });
  }

  if (btnSalvar) {
    btnSalvar.addEventListener('click', async () => {
      const novoConteudo = editorTextarea.value;
      const ok = await atualizarDocumento(salaId, novoConteudo);
      if (ok) {
        window.__docAtual = novoConteudo;
        docContent.innerHTML = renderizarMarkdown(novoConteudo);
        docEditor.classList.remove('doc-editor--active');
        docContent.classList.remove('doc-content--hidden');
        showToast('Documento salvo!');
      }
    });
  }
}

function atualizarVisualizacao(conteudo) {
  const docContent = document.getElementById('docContent');
  if (docContent) {
    window.__docAtual = conteudo;
    const docEditor = document.getElementById('docEditor');
    const editorAberto = docEditor && docEditor.classList.contains('doc-editor--active');
    if (!editorAberto) {
      docContent.innerHTML = renderizarMarkdown(conteudo);
    }
  }
}
