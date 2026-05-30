import forge from 'node-forge';
import fs from 'node:fs';
import { paths } from './config.js';

export interface Pem {
  key: string;
  cert: string;
}

/**
 * A tiny certificate authority used for TLS man-in-the-middle. The root CA is
 * generated once and stored under ~/.airlock; leaf certificates are minted on
 * demand per SNI host (signed by the root) and cached in memory.
 */
export class CertAuthority {
  private caCertPem: string;
  private caCert: forge.pki.Certificate;
  private caKey: forge.pki.rsa.PrivateKey;
  private leafKeys: forge.pki.rsa.KeyPair;
  private leafKeyPem: string;
  private cache = new Map<string, Pem>();

  constructor(private home: string) {
    const p = paths(home);
    if (fs.existsSync(p.caCert) && fs.existsSync(p.caKey)) {
      this.caCertPem = fs.readFileSync(p.caCert, 'utf8');
      this.caCert = forge.pki.certificateFromPem(this.caCertPem);
      this.caKey = forge.pki.privateKeyFromPem(fs.readFileSync(p.caKey, 'utf8')) as forge.pki.rsa.PrivateKey;
    } else {
      const root = generateRootCA();
      this.caCertPem = root.certPem;
      this.caCert = root.cert;
      this.caKey = root.key;
      fs.writeFileSync(p.caCert, root.certPem);
      fs.writeFileSync(p.caKey, root.keyPem, { mode: 0o600 });
    }
    // A single leaf keypair is reused across all minted host certs — fine for a
    // local MITM and far cheaper than generating a keypair per host.
    this.leafKeys = forge.pki.rsa.generateKeyPair(2048);
    this.leafKeyPem = forge.pki.privateKeyToPem(this.leafKeys.privateKey);
  }

  get caCertificatePem(): string {
    return this.caCertPem;
  }

  certFor(host: string | undefined): Pem {
    const name = host || 'localhost';
    const cached = this.cache.get(name);
    if (cached) return cached;

    const cert = forge.pki.createCertificate();
    cert.publicKey = this.leafKeys.publicKey;
    cert.serialNumber = randomSerial();
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
    cert.validity.notAfter = new Date(Date.now() + 397 * 24 * 3600 * 1000);
    cert.setSubject([{ name: 'commonName', value: name }]);
    cert.setIssuer(this.caCert.subject.attributes);
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(name);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [isIp ? { type: 7, ip: name } : { type: 2, value: name }],
      },
    ]);
    cert.sign(this.caKey, forge.md.sha256.create());

    const pem: Pem = { key: this.leafKeyPem, cert: forge.pki.certificateToPem(cert) };
    this.cache.set(name, pem);
    return pem;
  }
}

function randomSerial(): string {
  // Positive hex serial; forge requires a hex string.
  return '00' + Date.now().toString(16) + Math.floor(Math.random() * 0xffff).toString(16);
}

function generateRootCA() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 3650 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: 'Airlock Proxy CA' },
    { name: 'organizationName', value: 'Airlock' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    cert,
    key: keys.privateKey,
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}
