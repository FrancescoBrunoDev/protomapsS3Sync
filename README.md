# Protomaps S3 Streaming Transfer

Questo script automatizza il processo di download dell'ultima build di Protomaps e il caricamento diretto su un bucket SeaweedFS S3 usando rclone, con gestione robusta degli errori, trasferimenti resumable e logging dettagliato.

## Caratteristiche

- 🌐 **Streaming Diretto**: Trasferisce i file direttamente da HTTP a S3 senza archiviazione locale
- 📊 **Logging Dettagliato**: File di log multipli per diversi aspetti del trasferimento
- 🔄 **Logica di Retry**: Retry automatici con backoff esponenziale
- 📈 **Monitoraggio Progress**: Progress e statistiche in tempo reale
- 🧹 **Cleanup**: Pulizia automatica degli upload parziali in caso di errore
- 🛡️ **Gestione Errori**: Gestione e recupero degli errori completi
- 🔍 **Scoperta Automatica**: Trova automaticamente l'ultima build disponibile via API
- 📦 **Fallback Intelligente**: Strategia di fallback multipla per trovare i file
- 🌍 **Mirror Support**: Supporto per mirror multipli di Protomaps

## Prerequisiti

1. **Runtime Bun** installato
2. **rclone** installato (installato automaticamente nel devcontainer)
3. **Credenziali SeaweedFS S3** configurate nel file `.env`

## Setup

1. Crea un file `.env` con le tue credenziali SeaweedFS:

```env
SEAWEEDFS_ENDPOINT=https://your-seaweedfs-endpoint.com:8333
SEAWEEDFS_ACCESS_KEY=your-access-key
SEAWEEDFS_SECRET_KEY=your-secret-key
SEAWEEDFS_BUCKET=protomaps
```

2. Installa le dipendenze:

```bash
bun install
```

## Utilizzo

### Utilizzo Base

Esegui lo script di trasferimento principale:

```bash
bun script.ts
```

### Monitoraggio Progress

Lo script crea log dettagliati nella directory `/workspaces/alpine/logs/`:

- **`transfer-progress.log`** - Aggiornamenti di progress di alto livello
- **`rclone-transfer.log`** - Output dettagliato di rclone con statistiche di trasferimento
- **`protomaps-transfer.log`** - Log completo dell'applicazione

#### Monitoraggio in Tempo Reale

Usa l'helper di monitoraggio per seguire il progress:

```bash
# Monitora il progress del trasferimento (default)
bun monitor.ts

# Monitora l'output dettagliato di rclone
bun monitor.ts rclone

# Monitora il log principale dell'applicazione
bun monitor.ts main
```

#### Monitoraggio Manuale

Puoi anche monitorare i log direttamente:

```bash
# Segui il progress del trasferimento
tail -f logs/transfer-progress.log

# Segui l'output dettagliato di rclone
tail -f logs/rclone-transfer.log

# Segui il log principale dell'applicazione
tail -f logs/protomaps-transfer.log
```

## Come Funziona

1. **Scoperta Automatica**: Lo script cerca l'ultima build di Protomaps tramite:
   - API dei metadati delle build: `https://build-metadata.protomaps.dev/builds.json`
   - Fallback a mirror noti se l'API non è disponibile
   - File di test per dimostrazione se nessuna build è trovata

2. **Configurazione**:
    - Configura rclone con le credenziali SeaweedFS S3
    - Imposta il remote HTTP per l'URL sorgente
    - Assicura che il bucket di destinazione esista

3. **Trasferimento Streaming**:
   - Usa `rclone copyto` per lo streaming diretto da HTTP a S3
   - Nessun storage locale richiesto (gestisce file da 120GB+)
   - Monitoraggio del progress in tempo reale con statistiche ogni 10 secondi

4. **Gestione Errori**:
   - Retry automatici (3 tentativi) con backoff esponenziale
   - Pulizia degli upload parziali in caso di errore
   - Logging dettagliato degli errori e recupero

5. **Verifica**:
   - Verifica l'upload riuscito
   - Lista il contenuto finale del bucket
   - Validazione MD5 quando disponibile

## Esempi di Output dei Log

### Log di Progress
```
[2024-01-15T10:30:00.000Z] 🔄 Starting transfer attempt 1/3
[2024-01-15T10:30:05.000Z] 📊 Transferred: 1.2 GiB / 120.5 GiB, 1%, 45.2 MiB/s, ETA 45m30s
[2024-01-15T10:30:15.000Z] 📊 Transferred: 2.8 GiB / 120.5 GiB, 2%, 52.1 MiB/s, ETA 42m15s
```

### Log di Rclone
```
2024/01/15 10:30:00 INFO  : Starting transfer of 20240115.pmtiles
2024/01/15 10:30:05 INFO  : 20240115.pmtiles: 1% done, 45.2 MiB/s, ETA 45m30s
2024/01/15 10:30:15 INFO  : 20240115.pmtiles: 2% done, 52.1 MiB/s, ETA 42m15s
```

### Log dell'Applicazione
```
[2024-01-15T10:30:00.000Z] 🔍 Searching for latest Protomaps build...
[2024-01-15T10:30:01.000Z] 🌐 Fetching builds metadata: https://build-metadata.protomaps.dev/builds.json
[2024-01-15T10:30:02.000Z] 🔍 Found 150 builds in metadata
[2024-01-15T10:30:03.000Z] ✅ Latest build details:
[2024-01-15T10:30:03.000Z]    📦 Filename: 20240115.pmtiles
[2024-01-15T10:30:03.000Z]    📅 Upload date: 2024-01-15
[2024-01-15T10:30:03.000Z]    📏 Size: 120.50 GB
[2024-01-15T10:30:03.000Z]    🔐 MD5: abc123ef...
```

## Recupero degli Errori

Lo script include un robusto recupero degli errori:

- **Problemi di Rete**: Retry automatici con backoff esponenziale
- **Upload Parziali**: Pulizia e riavvio dall'inizio
- **Errori di Configurazione**: Messaggi di errore chiari e validazione
- **Problemi SeaweedFS**: Test di connessione e creazione del bucket
- **Mirror Fallback**: Tentativo di mirror multipli se l'API principale non è disponibile
- **File di Test**: Uso di file di test se nessuna build è disponibile

## Test

Testa la tua configurazione S3 con un file piccolo:

```bash
bun test-script.ts
```

Questo script:
- Configura rclone con le tue credenziali
- Crea un file di test piccolo
- Lo carica su SeaweedFS
- Verifica l'upload
- Lista il contenuto del bucket

## Risoluzione Problemi

### Problemi Comuni

1. **Connessione SeaweedFS Fallita**
   - Controlla le credenziali nel file `.env`
   - Verifica l'accessibilità dell'endpoint SeaweedFS
   - Assicurati che firewall/rete permettano la connessione

2. **Trasferimento Bloccato**
   - Controlla la connettività di rete
   - Monitora il log di rclone per messaggi di errore dettagliati
   - Aumenta i valori di timeout se necessario

3. **Spazio Insufficiente**
   - Assicurati di avere spazio sufficiente nel bucket S3
   - Controlla le quote di storage di SeaweedFS

4. **Build Non Trovata**
   - L'API dei metadati potrebbe essere temporaneamente non disponibile
   - Lo script proverà automaticamente i mirror noti
   - Come ultima risorsa, userà un file di test per dimostrare il processo

### Modalità Debug

Per output più verboso, puoi modificare il comando rclone nello script per includere:
```bash
--log-level=DEBUG
```

## Ottimizzazione delle Prestazioni

Lo script è ottimizzato per trasferimenti di grandi dimensioni:

- **Streaming**: Nessun storage locale richiesto
- **Timeout**: Configurati per trasferimenti a lungo termine
- **Retry**: Livelli di retry multipli (rclone + livello applicazione)
- **Progress**: Aggiornamenti regolari senza sovraccaricare i log
- **Scoperta Intelligente**: API dei metadati per trovare l'ultima build
- **Fallback Robusti**: Strategia di fallback multipla per massima affidabilità

## Variabili d'Ambiente

| Variabile | Richiesta | Descrizione | Default |
|-----------|-----------|-------------|---------|
| `SEAWEEDFS_ENDPOINT` | Sì | Endpoint completo del server SeaweedFS (incluso protocollo e porta, es: `https://seaweedfs.example.com:8333`) | - |
| `SEAWEEDFS_ACCESS_KEY` | Sì | Chiave di accesso SeaweedFS | - |
| `SEAWEEDFS_SECRET_KEY` | Sì | Chiave segreta SeaweedFS | - |
| `SEAWEEDFS_BUCKET` | No | Nome del bucket di destinazione | protomaps |

## Struttura dei File

```
/workspaces/alpine/
├── script.ts              # Script di trasferimento principale
├── monitor.ts             # Helper per monitoraggio log
├── test-script.ts         # Test di connessione S3
├── package.json           # Configurazione dipendenze
├── tsconfig.json          # Configurazione TypeScript
├── .env                   # Credenziali SeaweedFS
├── logs/                  # Directory dei log
│   ├── transfer-progress.log    # Progress di alto livello
│   ├── rclone-transfer.log      # Output dettagliato rclone
│   └── protomaps-transfer.log   # Log completo applicazione
└── README.md              # Questo file
```

## API e Mirror Supportati

Lo script supporta:

- **API Primaria**: `https://build-metadata.protomaps.dev/builds.json`
- **Mirror Noti**:
  - `https://r2-public.protomaps.com/protomaps-sample-datasets/planet.pmtiles`
  - `https://data.source.coop/protomaps/openstreetmap/planet.pmtiles`
  - `https://build.protomaps.com/planet.pmtiles`
  - `https://builds.protomaps.com/planet.pmtiles`
- **File di Test**: `terrarium-z12.pmtiles` per test/dimostrazione
