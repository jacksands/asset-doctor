// Referencia compartilhada do STATE unico criado em main.mjs.
let _s = null;
export const _setStateRef = (s) => { _s = s; };
export const _getState = () => _s;
