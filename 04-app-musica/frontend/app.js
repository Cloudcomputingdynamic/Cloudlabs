// App de música: inicio de sesión con Cognito (login alojado + código de autorización con PKCE),
// catálogo y reproductor (API de usuarios) y subida de canciones (API de administración).
const C = window.CONFIG;
const RETORNO = location.origin + '/'; // la misma página en CloudFront; tiene que estar igual en el app client
const $ = (id) => document.getElementById(id);

// ---------- Sesión con Cognito ----------

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
	.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function aleatorio(n) {
	return base64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function iniciarSesion() {
	// PKCE: un secreto de un solo uso (verifier) que solo conoce este navegador; a Cognito se le manda su huella
	const verifier = aleatorio(48);
	const huella = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	const estado = aleatorio(16);
	sessionStorage.setItem('pkce', verifier);
	sessionStorage.setItem('estado', estado);
	const p = new URLSearchParams({
		response_type: 'code', client_id: C.clienteId, redirect_uri: RETORNO, scope: 'openid email',
		code_challenge_method: 'S256', code_challenge: base64url(huella), state: estado,
	});
	location.assign(`${C.cognitoDominio}/oauth2/authorize?${p}`);
}

async function canjearCodigo(codigo, estado) {
	if (estado !== sessionStorage.getItem('estado')) throw new Error('El estado no coincide');
	const r = await fetch(`${C.cognitoDominio}/oauth2/token`, {
		method: 'POST',
		headers: {'Content-Type': 'application/x-www-form-urlencoded'},
		body: new URLSearchParams({
			grant_type: 'authorization_code', client_id: C.clienteId, code: codigo, redirect_uri: RETORNO,
			code_verifier: sessionStorage.getItem('pkce'),
		}),
	});
	if (!r.ok) throw new Error(`Cognito respondió ${r.status}`);
	const tokens = await r.json();
	sessionStorage.setItem('tokens', JSON.stringify(tokens));
	sessionStorage.removeItem('pkce');
	sessionStorage.removeItem('estado');
}

function leerToken(jwt) {
	const cuerpo = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
	const bytes = Uint8Array.from(atob(cuerpo), (c) => c.charCodeAt(0));
	return JSON.parse(new TextDecoder().decode(bytes));
}

function sesion() {
	const tokens = JSON.parse(sessionStorage.getItem('tokens') || 'null');
	if (!tokens) return null;
	const id = leerToken(tokens.id_token);
	if (id.exp * 1000 < Date.now()) { // el token dura 1 hora
		sessionStorage.removeItem('tokens');
		return null;
	}
	return {acceso: tokens.access_token, correo: id.email, grupos: id['cognito:groups'] || []};
}

function cerrarSesion() {
	sessionStorage.removeItem('tokens');
	const p = new URLSearchParams({client_id: C.clienteId, logout_uri: RETORNO});
	location.assign(`${C.cognitoDominio}/logout?${p}`);
}

// ---------- Llamadas a las API ----------

async function llamar(api, ruta, opciones = {}) {
	const r = await fetch(api + ruta, {
		...opciones,
		headers: {...opciones.headers, Authorization: `Bearer ${sesion().acceso}`},
	});
	const datos = await r.json().catch(() => ({}));
	if (!r.ok) throw Object.assign(new Error(datos.error || datos.message || `Error ${r.status}`), {codigo: r.status});
	return datos;
}

// ---------- Catálogo ----------

let canciones = [];   // lo que devolvió GET /canciones
let actual = -1;      // índice de la canción que suena

const ICONO = {
	play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>',
	pausa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
};
const COLORES = [['#1f6fe5', '#2fd4ff'], ['#ff7a3d', '#ffc53d'], ['#7b4dff', '#2fd4ff'], ['#2aa84a', '#2fd4ff'],
	['#e0245e', '#ff7a3d'], ['#1f6fe5', '#7b4dff']];

// Carátula generada a partir del título: siempre el mismo degradado para la misma canción
function caratula(c, elemento) {
	let h = 0;
	for (const letra of c.artista + c.titulo) h = (h * 31 + letra.charCodeAt(0)) >>> 0;
	const [c1, c2] = COLORES[h % COLORES.length];
	elemento.classList.add('caratula');
	elemento.style.background = `linear-gradient(${h % 360}deg, ${c1}, ${c2})`;
	elemento.style.setProperty('--c1', c1);
	const centro = document.createElement('span');
	centro.textContent = c.titulo.charAt(0).toUpperCase();
	elemento.replaceChildren(centro);
	return elemento;
}

async function cargarCatalogo() {
	({canciones} = await llamar(C.apiUsuarios, '/listar'));
	const lista = $('lista');
	lista.replaceChildren();
	if (!canciones.length) lista.innerHTML = '<li class="vacio">Todavía no hay canciones.</li>';
	canciones.forEach((c, i) => {
		const li = document.createElement('li');
		li.className = 'cancion';
		const titulo = document.createElement('strong');
		titulo.textContent = c.titulo;
		const artista = document.createElement('small');
		artista.textContent = c.artista;
		const boton = document.createElement('button');
		boton.className = 'boton-play';
		boton.innerHTML = ICONO.play;
		boton.title = `Escuchar ${c.titulo}`;
		li.append(caratula(c, document.createElement('div')), titulo, artista, boton);
		li.classList.toggle('activa', i === actual);
		li.onclick = () => (i === actual ? alternar() : reproducir(i));
		lista.append(li);
	});
	$('resumen').textContent = canciones.length === 1 ? '1 canción en la nube' : `${canciones.length} canciones en la nube`;
	$('reproducir-todo').disabled = !canciones.length;
	if (actual >= 0) iconos(!audio.paused);
	return canciones.length;
}

// ---------- Reproductor ----------

const audio = $('audio');
const minutos = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

function mostrarEstado(texto) {
	$('sonando').textContent = texto;
	$('sonando').className = texto ? 'estado error' : 'estado';
}

async function reproducir(i) {
	const c = canciones[i];
	if (!c) return;
	actual = i;
	document.querySelectorAll('.cancion').forEach((li, k) => li.classList.toggle('activa', k === i));
	$('reproductor').hidden = false;
	document.body.classList.add('con-reproductor');
	$('sonando-titulo').textContent = c.titulo;
	$('sonando-artista').textContent = c.artista;
	caratula(c, $('caratula'));
	mostrarEstado('');
	try {
		const q = new URLSearchParams({artista: c.artista, titulo: c.titulo});
		const {url} = await llamar(C.apiUsuarios, `/reproducir?${q}`);
		audio.src = url; // URL prefirmada: el archivo baja directo desde S3
		await audio.play();
	} catch (e) {
		if (e.name !== 'NotSupportedError') mostrarEstado(`✗ ${e.codigo || ''} ${e.message}`);
	}
}

function alternar() {
	if (actual < 0) return reproducir(0);
	audio.paused ? audio.play() : audio.pause();
}

function pintarAvance(rango, fraccion) {
	rango.style.setProperty('--avance', `${fraccion * 100}%`);
}

// El botón principal y el de la tarjeta que suena muestran ⏸ mientras hay música
function iconos(sonando) {
	document.body.classList.toggle('reproduciendo', sonando);
	$('pausa').innerHTML = sonando ? ICONO.pausa : ICONO.play;
	document.querySelectorAll('.boton-play').forEach((b, k) => {
		b.innerHTML = sonando && k === actual ? ICONO.pausa : ICONO.play;
	});
}

audio.onplay = () => iconos(true);
audio.onpause = () => iconos(false);
audio.onended = () => (actual + 1 < canciones.length ? reproducir(actual + 1) : audio.onpause());
audio.onerror = () => { // p. ej. S3 respondió 403 a la URL prefirmada
	if (audio.src) mostrarEstado('✗ S3 no entregó el archivo (revisar el rol de musica-reproducir)');
};
audio.ontimeupdate = () => {
	const fraccion = audio.duration ? audio.currentTime / audio.duration : 0;
	$('barra-progreso').value = fraccion * 1000;
	pintarAvance($('barra-progreso'), fraccion);
	$('tiempo-actual').textContent = minutos(audio.currentTime);
	$('tiempo-total').textContent = minutos(audio.duration);
};
$('barra-progreso').oninput = (e) => {
	if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
};
$('volumen').oninput = (e) => {
	audio.volume = e.target.value / 100;
	pintarAvance(e.target, audio.volume);
};
pintarAvance($('volumen'), 0.8);
audio.volume = 0.8;

// ---------- Subir una canción (solo admin) ----------

async function subir(evento) {
	evento.preventDefault();
	const f = new FormData(evento.target);
	const estado = $('estado-subida');
	const boton = evento.target.querySelector('button');
	boton.disabled = true;
	estado.className = 'estado';
	try {
		estado.textContent = 'Pidiendo permiso de subida…';
		const permiso = await llamar(C.apiAdmin, '/subir', {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({artista: f.get('artista'), titulo: f.get('titulo')}),
		});
		// El navegador sube la canción directo a S3 con el permiso firmado (el archivo va al final)
		estado.textContent = 'Subiendo a S3…';
		const formulario = new FormData();
		for (const [k, v] of Object.entries(permiso.campos)) formulario.append(k, v);
		formulario.append('file', f.get('archivo'));
		const r = await fetch(permiso.url, {method: 'POST', body: formulario});
		if (!r.ok) throw new Error(`S3 respondió ${r.status}`);

		// S3 avisa a registrar-cancion; esperamos a que aparezca en el catálogo
		estado.textContent = 'Registrando en el catálogo…';
		const antes = canciones.length;
		let registrada = false;
		for (let i = 0; i < 8 && !registrada; i++) {
			await new Promise((ok) => setTimeout(ok, 1500));
			registrada = await cargarCatalogo() > antes;
		}
		if (!registrada) throw new Error('La canción quedó en S3, pero no apareció en el catálogo (revisar el evento del bucket y los logs de registrar-cancion)');
		estado.textContent = `✓ ${f.get('titulo')} ya está en el catálogo`;
		estado.className = 'estado ok';
		evento.target.reset();
		mostrarArchivo();
	} catch (e) {
		estado.textContent = `✗ ${e.codigo || ''} ${e.message}`;
		estado.className = 'estado error';
	} finally {
		boton.disabled = false;
	}
}

function mostrarArchivo() {
	const archivo = $('formulario').archivo.files[0];
	$('nombre-archivo').textContent = archivo ? archivo.name : 'Elige un mp3 o arrástralo aquí';
	document.querySelector('.zona').classList.toggle('lista', !!archivo);
}

// ---------- Inicio ----------

function saludo(correo) {
	const hora = new Date().getHours();
	const parte = hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
	return `${parte}, ${correo.split('@')[0]}`;
}

async function iniciar() {
	const p = new URLSearchParams(location.search);
	if (p.get('code')) {
		try {
			await canjearCodigo(p.get('code'), p.get('state'));
		} catch (e) {
			alert(`No se pudo iniciar sesión: ${e.message}`);
		}
		history.replaceState(null, '', RETORNO); // quita ?code=… de la barra de direcciones
	}

	$('entrar').onclick = iniciarSesion;
	$('entrar-portada').onclick = iniciarSesion;
	$('salir').onclick = cerrarSesion;
	$('actualizar').onclick = async () => {
		const b = $('actualizar');
		b.disabled = true;
		b.textContent = 'Actualizando…';
		try {
			await cargarCatalogo();
		} catch (e) {
			alert(`No se pudo cargar el catálogo: ${e.message}`);
		} finally {
			b.disabled = false;
			b.textContent = '↻ Actualizar';
		}
	};
	$('reproducir-todo').onclick = () => reproducir(0);
	$('pausa').onclick = alternar;
	$('anterior').onclick = () => reproducir(Math.max(0, actual - 1));
	$('siguiente').onclick = () => reproducir(Math.min(canciones.length - 1, actual + 1));
	$('formulario').onsubmit = subir;
	$('formulario').archivo.onchange = mostrarArchivo;

	const s = sesion();
	if (!s) return;
	const admin = s.grupos.includes('admin');
	$('entrar').hidden = true;
	$('salir').hidden = false;
	$('usuario').textContent = s.correo;
	$('insignia').hidden = !admin;
	$('bienvenida').hidden = true;
	$('app').hidden = false;
	$('saludo').textContent = saludo(s.correo);
	// El panel de subida se muestra a todos: quien protege la subida es la API (403 si no es admin), no la página
	cargarCatalogo().catch((e) => alert(e.message));
}

iniciar();
