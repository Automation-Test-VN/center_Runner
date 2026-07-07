pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    string(name: 'CENTER_RUNNER_ROOT', defaultValue: '${WORKSPACE}', description: 'Path to the Center Runner repo on the Jenkins agent.')
    string(name: 'TEST_REPO_ROOT', defaultValue: 'D:\\workspace\\TS_PW_FBC', description: 'Path to the TS_PW_FBC test repo on the Jenkins agent.')
    string(name: 'WORKER_ENV_CREDENTIALS_ID', defaultValue: 'WORKER_ENV', description: 'Jenkins Secret file credential ID holding the worker env (copied to CENTER_RUNNER_ROOT\\worker.env). This is the source of truth for worker config: CENTER_RUNNER_URL, WORKER_IP, WORKER_NAME, WORKER_COUNT, CENTER_RUNNER_INTERVAL_MS, etc.')
    string(name: 'TEST_ENV_CREDENTIALS_ID', defaultValue: '', description: 'Optional Jenkins Secret file credential ID for the TS_PW_FBC .env (accounts, sheet creds). Leave blank if the test repo already has its .env on the machine.')
  }

  environment {
    // Only paths the .bat layer needs directly (cmd cannot read .env).
    // Connection/worker vars intentionally come from the WORKER_ENV .env instead.
    CENTER_RUNNER_ROOT = "${params.CENTER_RUNNER_ROOT}"
    TEST_REPO_ROOT = "${params.TEST_REPO_ROOT}"
  }

  stages {
    stage('Prepare worker .env') {
      steps {
        withCredentials([file(credentialsId: "${params.WORKER_ENV_CREDENTIALS_ID}", variable: 'CENTER_ENV_FILE')]) {
          dir("${params.CENTER_RUNNER_ROOT}") {
            bat 'jenkins\\prepare-env.bat worker.env'
          }
        }
      }
    }

    stage('Prepare test repo .env') {
      when {
        expression { return params.TEST_ENV_CREDENTIALS_ID?.trim() }
      }
      steps {
        withCredentials([file(credentialsId: "${params.TEST_ENV_CREDENTIALS_ID}", variable: 'ALL_DOMAINS_ENV_FILE')]) {
          dir("${params.CENTER_RUNNER_ROOT}") {
            bat 'jenkins\\prepare-secret-env.bat'
          }
        }
      }
    }

    stage('Install Dependencies') {
      steps {
        dir("${params.CENTER_RUNNER_ROOT}") {
          bat 'jenkins\\install-deps.bat'
        }
      }
    }

    stage('Run Workers') {
      steps {
        dir("${params.CENTER_RUNNER_ROOT}") {
          bat 'jenkins\\start-workers.bat'
        }
      }
    }
  }
}
