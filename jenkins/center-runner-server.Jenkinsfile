pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    string(name: 'CENTER_RUNNER_ROOT', defaultValue: 'D:\\workspace\\center_Runner', description: 'Path to the Center Runner repo on the Jenkins agent.')
    string(name: 'TEST_REPO_ROOT', defaultValue: 'D:\\workspace\\TS_PW_FBC', description: 'Path to the TS_PW_FBC test repo on the Jenkins agent.')
    string(name: 'SERVER_ENV_CREDENTIALS_ID', defaultValue: 'SERVER_ENV', description: 'Jenkins Secret file credential ID holding the server env (copied to CENTER_RUNNER_ROOT\\server.env). Source of truth for CENTER_RUNNER_HOST, CENTER_RUNNER_PORT, CENTER_RUNNER_TEST_REPO, CENTER_RUNNER_WORKER_WAIT_TIMEOUT_MS.')
    string(name: 'TEST_ENV_CREDENTIALS_ID', defaultValue: '', description: 'Optional Jenkins Secret file credential ID for the TS_PW_FBC .env (accounts, sheet creds). Leave blank if the test repo already has its .env on the machine.')
  }

  environment {
    // Only paths the .bat layer needs directly (cmd cannot read .env).
    // Server config vars come from the SERVER_ENV .env instead.
    CENTER_RUNNER_ROOT = "${params.CENTER_RUNNER_ROOT}"
    TEST_REPO_ROOT = "${params.TEST_REPO_ROOT}"
  }

  stages {
    stage('Prepare server .env') {
      steps {
        withCredentials([file(credentialsId: "${params.SERVER_ENV_CREDENTIALS_ID}", variable: 'CENTER_ENV_FILE')]) {
          dir("${params.CENTER_RUNNER_ROOT}") {
            bat 'jenkins\\prepare-env.bat server.env'
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

    stage('Run Server') {
      steps {
        // Long-running: this stage stays active while the server is online.
        // Stop the build to stop the server.
        dir("${params.CENTER_RUNNER_ROOT}") {
          bat 'jenkins\\start-server.bat'
        }
      }
    }
  }
}
