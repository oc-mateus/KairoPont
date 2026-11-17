const CPF = /^\d{11}$/;
const CNPJ = /^[A-Z0-9]{12}\d{2}$/;

export function normalizeEmployeeDocument(value) {
  return typeof value === 'string' ? value.replace(/[.\s/-]/g, '').replace(/[a-z]/g, (letter) => letter.toUpperCase()) : '';
}

export function isCnpjDocument(value) {
  return CNPJ.test(normalizeEmployeeDocument(value));
}

export function validateCPF(value) {
  const cpf = normalizeEmployeeDocument(value);
  if (!CPF.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  const digit = (length) => {
    const sum = [...cpf.slice(0, length)].reduce((total, char, index) => total + Number(char) * (length + 1 - index), 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function validateCnpj(cnpj) {
  if (!CNPJ.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;

  // Receita Federal uses the ASCII value minus 48 and cycles weights 2–9 from the right.
  const digit = (length) => {
    const sum = [...cnpj.slice(0, length)].reduce((total, char, index) => {
      const weight = 2 + ((length - 1 - index) % 8);
      return total + (char.charCodeAt(0) - 48) * weight;
    }, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

export function validateEmployeeDocument(value, contract) {
  return validateCPF(value) || (contract === 'pj' && validateCnpj(normalizeEmployeeDocument(value)));
}

export function formatEmployeeDocument(value) {
  const document = normalizeEmployeeDocument(value);
  if (CNPJ.test(document)) return document.replace(/^(..)(...)(...)(....)(..)$/, '$1.$2.$3/$4-$5');
  if (CPF.test(document)) return document.replace(/^(...)(...)(...)(..)$/, '$1.$2.$3-$4');
  return value ?? '';
}
