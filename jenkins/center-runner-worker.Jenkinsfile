pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  environment {
    // Định nghĩa trực tiếp các đường dẫn cố định tại đây
    CENTER_RUNNER_ROOT         = "${WORKSPACE}"
    TEST_REPO_ROOT             = "D:\\workspace\\TS_PW_FBC"
    
    // Đưa các ID Credentials vào môi trường để quản lý tập trung
    WORKER_ENV_CREDENTIALS_ID  = "WORKER_ENV"
    TEST_ENV_CREDENTIALS_ID    = "" // Để trống nếu test repo đã có sẵn file .env trên máy agent
  }

  stages {
    stage('Prepare worker .env') {
      steps {
        // Sử dụng env.WORKER_ENV_CREDENTIALS_ID thay vì params
        withCredentials([file(credentialsId: "${env.WORKER_ENV_CREDENTIALS_ID}", variable: 'CENTER_ENV_FILE')]) {
          dir("${env.CENTER_RUNNER_ROOT}") {
            bat 'jenkins\\prepare-env.bat worker.env'
          }
        }
      }
    }

    stage('Prepare test repo .env') {
      when {
        // Kiểm tra biến môi trường có rỗng hay không trước khi chạy stage
        expression { return env.TEST_ENV_CREDENTIALS_ID?.trim() }
      }
      steps {
        withCredentials([file(credentialsId: "${env.TEST_ENV_CREDENTIALS_ID}", variable: 'ALL_DOMAINS_ENV_FILE')]) {
          dir("${env.CENTER_RUNNER_ROOT}") {
            bat 'jenkins\\prepare-secret-env.bat'
          }
        }
      }
    }

    stage('Install Dependencies') {
      steps {
        dir("${env.CENTER_RUNNER_ROOT}") {
          bat 'jenkins\\install-deps.bat'
        }
      }
    }

    stage('Run Workers') {
      steps {
        dir("${env.CENTER_RUNNER_ROOT}") {
          bat 'jenkins\\start-workers.bat'
        }
      }
    }
  }
}