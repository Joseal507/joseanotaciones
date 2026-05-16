'use client';

import Link from 'next/link';

const HAND = "'Caveat',cursive";

const SECCIONES = [
  { n:1, t:'Introducción', c:`Bienvenido a StudyAL. Estos Términos y Condiciones ("Términos") regulan el acceso y uso de la plataforma, sitio web, aplicaciones y servicios relacionados ofrecidos por StudyAL ("StudyAL", "la Plataforma", "nosotros" o "nuestro").\n\nAl acceder, registrarse o utilizar StudyAL, el usuario acepta quedar legalmente vinculado por estos Términos y por nuestra Política de Privacidad. Si el usuario no está de acuerdo con alguna parte de estos Términos, deberá abstenerse de utilizar la Plataforma.\n\nStudyAL es una plataforma educativa diseñada para ayudar a estudiantes mediante herramientas de organización académica, inteligencia artificial, recursos educativos y funcionalidades de colaboración.` },
  { n:2, t:'Elegibilidad y cuentas', c:`Para utilizar StudyAL, el usuario debe cumplir con los requisitos mínimos de edad establecidos por las leyes aplicables en su jurisdicción. Si el usuario es menor de la edad requerida para otorgar consentimiento digital en su jurisdicción, el uso de la Plataforma deberá realizarse con autorización de un padre, madre o tutor legal.\n\nStudyAL no recopila intencionalmente información personal de menores en violación de las leyes aplicables de protección de datos.\n\nEl usuario es responsable de:\n• proporcionar información verídica y actualizada;\n• mantener la confidencialidad de sus credenciales de acceso;\n• todas las actividades realizadas desde su cuenta.\n\nStudyAL podrá suspender o eliminar cuentas que:\n• contengan información falsa;\n• infrinjan estos Términos;\n• representen riesgos de seguridad o uso indebido de la Plataforma.\n\nLa información asociada a la cuenta puede incluir: nombre, correo electrónico, contraseña, foto de perfil, institución educativa, carrera, descripción del perfil, preferencias y configuraciones de uso.` },
  { n:3, t:'Servicios ofrecidos', c:`StudyAL ofrece herramientas y servicios educativos digitales, incluyendo, entre otros:\n• cursos y ejercicios en línea;\n• quizzes y flashcards;\n• herramientas de organización académica;\n• gestión de materias, horarios y asignaciones;\n• almacenamiento de apuntes y archivos;\n• herramientas de colaboración;\n• estadísticas y análisis de progreso;\n• recomendaciones personalizadas;\n• chats, foros y espacios de interacción;\n• funcionalidades impulsadas por inteligencia artificial.\n\nLa Plataforma puede permitir el procesamiento y análisis de distintos tipos de archivos y contenido, incluyendo: documentos PDF, archivos Word y PowerPoint, imágenes, audios, texto, enlaces externos, notas y materiales educativos.\n\nStudyAL podrá modificar, actualizar, limitar o descontinuar funcionalidades de la Plataforma en cualquier momento y sin previo aviso.` },
  { n:4, t:'Contenido del usuario', c:`Los usuarios pueden subir, almacenar, compartir o generar contenido dentro de la Plataforma, incluyendo documentos, imágenes, audios, apuntes, tareas, mensajes, quizzes y otros materiales educativos ("Contenido del Usuario").\n\nEl usuario mantiene la propiedad intelectual sobre el Contenido del Usuario que publique o cargue en StudyAL. Sin embargo, al utilizar la plataforma, el usuario otorga a StudyAL una licencia limitada, no exclusiva y necesaria para almacenar, procesar, analizar y mostrar dicho contenido con el propósito de operar y mejorar los servicios ofrecidos.\n\nEl usuario declara y garantiza que:\n• posee los derechos necesarios sobre el contenido que sube;\n• el contenido no infringe derechos de terceros;\n• el contenido no es ilegal, ofensivo o fraudulento.\n\nStudyAL podrá eliminar contenido que:\n• infrinja derechos de autor;\n• viole estos Términos;\n• represente riesgos legales, de seguridad o académicos.\n\nEl usuario reconoce y acepta que ciertas funcionalidades de inteligencia artificial pueden analizar, interpretar o procesar el Contenido del Usuario para generar respuestas, recomendaciones, quizzes, resúmenes u otros resultados automatizados.` },
  { n:5, t:'Inteligencia Artificial', c:`StudyAL utiliza herramientas de inteligencia artificial para analizar contenido, responder preguntas, generar resúmenes, quizzes, flashcards, recomendaciones y otras funcionalidades educativas automatizadas.\n\nEl usuario reconoce y acepta que:\n• las respuestas y resultados generados por inteligencia artificial pueden contener errores, imprecisiones o información incompleta;\n• la inteligencia artificial no reemplaza asesoría académica, profesional, legal, médica o financiera;\n• el usuario es responsable de verificar la exactitud y utilidad de cualquier contenido generado por la Plataforma.\n\nStudyAL podrá procesar textos, imágenes, audios, documentos y otros materiales proporcionados por el usuario con el fin de ofrecer funcionalidades impulsadas por inteligencia artificial.\n\nEl usuario se compromete a no utilizar las herramientas de inteligencia artificial para:\n• actividades ilegales;\n• fraude académico;\n• generación de contenido ofensivo o dañino;\n• violación de derechos de terceros;\n• distribución de malware, spam o contenido malicioso.\n\nStudyAL no garantiza que las funcionalidades de inteligencia artificial estén libres de interrupciones, errores o resultados no deseados.` },
  { n:6, t:'Datos almacenados', c:`StudyAL puede recopilar, almacenar, organizar y procesar información proporcionada por los usuarios o generada mediante el uso de la Plataforma con el propósito de operar, mantener, mejorar y personalizar los servicios ofrecidos.\n\nLa información almacenada puede incluir:\n\n📌 Información de cuenta y perfil:\nnombre, correo electrónico, contraseña cifrada, foto de perfil, institución educativa, carrera, tipo de estudiante, descripción o biografía, preferencias y configuraciones.\n\n📌 Información académica y de aprendizaje:\nmaterias, clases y horarios, asignaciones y objetivos, notas y calificaciones, progreso académico, resultados de quizzes, estadísticas y análisis, hábitos y patrones de estudio, certificaciones obtenidas.\n\n📌 Contenido subido o generado:\napuntes, flashcards, quizzes, highlights, mensajes, archivos cargados, enlaces compartidos, contenido generado por IA.\n\n📌 Formatos compatibles:\nPDF, Word, PowerPoint, TXT, JPG, PNG, WebP, audios y otros formatos.\n\n📌 Información de actividad:\nhistorial de navegación dentro de la Plataforma, fecha y hora de acceso, interacciones con otros usuarios, participación en chats/foros, uso de IA, información técnica.\n\nStudyAL podrá utilizar esta información para: proporcionar y mejorar servicios, personalizar la experiencia, generar recomendaciones, desarrollar funcionalidades, mantener seguridad, detectar fraudes o abusos.\n\nEl tratamiento de datos personales se realizará conforme a la Política de Privacidad y a las leyes aplicables.` },
  { n:7, t:'Conducta prohibida', c:`Al utilizar StudyAL, el usuario acepta no:\n• utilizar la Plataforma para actividades ilegales o no autorizadas;\n• subir contenido que infrinja derechos de autor o propiedad intelectual;\n• acosar, amenazar o perjudicar a otros usuarios;\n• distribuir virus, malware o software malicioso;\n• intentar acceder sin autorización a sistemas, cuentas o datos;\n• utilizar bots, scraping automatizado o herramientas similares;\n• interferir con el funcionamiento normal de la Plataforma;\n• utilizar la Plataforma para hacer trampa académica o fraude educativo;\n• compartir información falsa, engañosa o fraudulenta;\n• utilizar StudyAL con fines comerciales no autorizados;\n• copiar, descargar masivamente, reproducir, modificar, redistribuir o utilizar contenido de la Plataforma para fines comerciales, competitivos o no autorizados sin consentimiento previo por escrito de StudyAL.\n\nStudyAL podrá investigar y tomar acciones contra cuentas que violen estas reglas, incluyendo la suspensión temporal o permanente del acceso.` },
  { n:8, t:'Pagos y suscripciones', c:`StudyAL ofrece funcionalidades gratuitas y funcionalidades premium disponibles mediante suscripción paga.\n\nLa suscripción premium incluye un período de prueba gratuito ("Free Trial") de siete (7) días. Una vez finalizado el período de prueba, la suscripción se renovará automáticamente bajo un plan mensual con un costo de USD $4.99 por mes, salvo cancelación realizada por el usuario antes de la finalización del período de prueba.\n\nAl suscribirse, el usuario autoriza el cobro automático correspondiente al método de pago seleccionado.\n\nTodos los pagos serán procesados mediante proveedores externos: PagueloFacil y Yappy. StudyAL no almacena directamente información financiera sensible.\n\nEl usuario es responsable de:\n• proporcionar información de pago válida y actualizada;\n• revisar los cargos aplicables antes de confirmar una suscripción;\n• cancelar la suscripción antes de la fecha de renovación si no desea continuar.\n\nSalvo disposición contraria exigida por ley, los pagos realizados no son reembolsables.\n\nStudyAL podrá suspender o cancelar el acceso premium por: pagos fallidos, actividad fraudulenta, contracargos, violaciones a estos Términos.\n\nStudyAL se reserva el derecho de modificar precios, beneficios o características de sus planes en cualquier momento.` },
  { n:9, t:'Privacidad y seguridad', c:`StudyAL valora la privacidad y seguridad de la información de sus usuarios y adopta medidas razonables para proteger los datos almacenados.\n\nStudyAL podrá implementar medidas de seguridad administrativas, técnicas y organizativas destinadas a:\n• proteger la información contra accesos no autorizados;\n• prevenir pérdida, alteración o divulgación indebida;\n• mantener la integridad y funcionamiento;\n• detectar actividades fraudulentas o maliciosas.\n\nSin embargo, el usuario reconoce que ningún sistema es completamente seguro. StudyAL no puede garantizar seguridad absoluta.\n\nEl usuario es responsable de:\n• mantener la confidencialidad de sus credenciales;\n• utilizar contraseñas seguras;\n• notificar inmediatamente cualquier acceso no autorizado.\n\nStudyAL podrá utilizar proveedores externos para alojamiento, pagos, almacenamiento, analítica, IA y otras funcionalidades.\n\nLa Plataforma puede utilizar cookies y tecnologías de seguimiento para: recordar preferencias, mejorar funcionalidades, analizar rendimiento, personalizar la experiencia.` },
  { n:10, t:'Propiedad intelectual', c:`Todos los derechos de propiedad intelectual relacionados con StudyAL y sus servicios, incluyendo diseño, logotipos, marcas, interfaz, software, bases de datos, funcionalidades, contenido educativo, elementos visuales, textos, gráficos, recursos multimedia, herramientas de IA, son propiedad de StudyAL o de sus respectivos licenciantes.\n\nEl acceso y uso de la Plataforma no otorgan al usuario ningún derecho de propiedad, salvo la licencia limitada, revocable, no exclusiva e intransferible necesaria para utilizar los servicios.\n\nEl usuario no podrá: copiar, reproducir, modificar, distribuir, vender, revender, explotar comercialmente, realizar ingeniería inversa, descargar masivamente, ni utilizar contenido o tecnología de la Plataforma para fines competitivos sin consentimiento previo por escrito de StudyAL.\n\nEl usuario conserva la propiedad intelectual sobre el contenido que suba o genere. Al utilizar StudyAL, el usuario concede una licencia limitada para almacenar, procesar, analizar, mostrar y utilizar dicho contenido únicamente con el propósito de operar, mantener y mejorar los servicios.\n\nStudyAL respeta los derechos de terceros y podrá remover contenido que presuntamente infrinja derechos.` },
  { n:11, t:'Terminación de cuentas', c:`StudyAL podrá suspender, restringir o terminar el acceso de un usuario en cualquier momento, incluyendo casos en los que el usuario:\n• viole estos Términos y Condiciones;\n• participe en actividades ilegales, fraudulentas o abusivas;\n• infrinja derechos de propiedad intelectual;\n• utilice la Plataforma para fraude académico;\n• intente comprometer la seguridad;\n• realice actividades que puedan perjudicar a StudyAL, otros usuarios o terceros.\n\nEl usuario podrá dejar de utilizar la Plataforma o solicitar la eliminación de su cuenta en cualquier momento.\n\nLa terminación o eliminación podrá resultar en:\n• pérdida de acceso a funcionalidades premium;\n• eliminación o pérdida de contenido almacenado;\n• pérdida de progreso, estadísticas, mensajes y configuraciones;\n• cancelación de acceso a servicios relacionados.\n\nStudyAL podrá conservar determinada información después de la terminación cuando sea necesario para: cumplir obligaciones legales, resolver disputas, prevenir fraude, hacer cumplir estos Términos, mantener registros.` },
  { n:12, t:'Limitación de responsabilidad', c:`StudyAL proporciona la Plataforma "tal cual" ("as is") y "según disponibilidad", sin garantías de ningún tipo.\n\nStudyAL no garantiza que:\n• la Plataforma funcionará de manera ininterrumpida o libre de errores;\n• los servicios estarán disponibles en todo momento;\n• el contenido generado por IA será exacto, completo o actualizado;\n• los archivos estarán libres de pérdida o accesos no autorizados;\n• los resultados académicos mejorarán mediante el uso de la Plataforma.\n\nEn la máxima medida permitida por la ley, StudyAL no será responsable por:\n• daños directos, indirectos, incidentales o consecuentes;\n• pérdida de datos, archivos, contenido o progreso académico;\n• interrupciones del servicio;\n• errores o imprecisiones en contenido generado por IA;\n• decisiones tomadas basadas en información de la Plataforma;\n• conflictos entre usuarios;\n• fallos de terceros (proveedores de pago, almacenamiento, IA);\n• acceso no autorizado a cuentas.\n\nEn ningún caso la responsabilidad total acumulada de StudyAL excederá el monto efectivamente pagado por el usuario durante los últimos doce (12) meses anteriores al evento que originó la reclamación.` },
  { n:13, t:'Modificaciones', c:`StudyAL podrá modificar, actualizar, suspender o descontinuar, total o parcialmente, la Plataforma en cualquier momento.\n\nAsimismo, StudyAL podrá modificar estos Términos cuando sea necesario para:\n• reflejar cambios en los servicios ofrecidos;\n• cumplir obligaciones legales o regulatorias;\n• incorporar nuevas funcionalidades;\n• mejorar la seguridad y funcionamiento;\n• adaptarse a cambios tecnológicos o comerciales.\n\nCuando las modificaciones sean relevantes, StudyAL podrá notificar a los usuarios mediante publicaciones dentro de la Plataforma, correo electrónico u otros medios razonables.\n\nLa fecha de "Última actualización" indicará la versión más reciente vigente.\n\nEl uso continuo de StudyAL después de las modificaciones constituirá la aceptación de los Términos actualizados.` },
  { n:14, t:'Ley aplicable', c:`Estos Términos se regirán e interpretarán de conformidad con las leyes de la República de Panamá, sin considerar sus principios sobre conflictos de leyes.\n\nCualquier disputa, reclamación o controversia relacionada con StudyAL será sometida a la jurisdicción competente de los tribunales de la República de Panamá, salvo que la ley aplicable disponga lo contrario.\n\nNada de lo establecido en esta sección limitará los derechos que puedan corresponder al usuario bajo leyes de protección al consumidor aplicables en su jurisdicción.` },
  { n:15, t:'Contacto', c:`Si el usuario tiene preguntas, comentarios, solicitudes o inquietudes relacionadas con estos Términos y Condiciones, la Plataforma o sus servicios, podrá contactar a StudyAL mediante los canales oficiales.\n\n📧 Correo electrónico de contacto: studyal496@gmail.com\n\nStudyAL procurará responder las solicitudes dentro de un plazo razonable.\n\nLas comunicaciones oficiales relacionadas con aspectos legales, privacidad, propiedad intelectual o soporte técnico deberán realizarse a través de los medios autorizados por StudyAL.` },
];

export default function TerminosPage() {
  return (
    <div style={{
      minHeight:'100vh',
      background:'var(--bg-primary)',
      padding:'40px 20px 80px',
    }}>
      <div style={{maxWidth:860,margin:'0 auto'}}>
        {/* Header */}
        <div style={{textAlign:'center',marginBottom:32}}>
          <Link href="/" style={{
            display:'inline-block',marginBottom:16,
            fontFamily:HAND,fontSize:18,fontWeight:700,
            color:'var(--gold)',textDecoration:'none',
            transform:'rotate(-2deg)',
          }}>← volver al inicio</Link>
          <h1 style={{
            fontFamily:HAND,fontSize:56,fontWeight:900,
            color:'var(--text-primary)',margin:0,lineHeight:1,
            transform:'rotate(-1deg)',display:'inline-block',
          }}>
            📜 Términos y Condiciones
          </h1>
          <svg width="320" height="8" style={{display:'block',margin:'8px auto 0'}}>
            <path d="M2 4 Q 160 0 318 5" stroke="var(--gold)" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".7"/>
          </svg>
          <p style={{
            fontFamily:HAND,fontSize:18,fontStyle:'italic',
            color:'var(--text-muted)',marginTop:12,
          }}>
            ~ Última actualización: 4 de mayo de 2026 ~
          </p>
        </div>

        {/* Índice */}
        <div style={{
          background:'var(--bg-card)',
          border:'2.5px solid var(--text-primary)',
          borderRadius:14,padding:'20px 24px',
          marginBottom:30,
          boxShadow:'4px 5px 0 var(--gold)',
          transform:'rotate(-.4deg)',
          position:'relative',
        }}>
          <div style={{position:'absolute',top:-11,left:'50%',transform:'translateX(-50%) rotate(-3deg)',width:80,height:18,background:'rgba(245,200,66,.55)',border:'1px solid rgba(245,200,66,.3)'}}/>
          <h2 style={{fontFamily:HAND,fontSize:28,fontWeight:900,color:'var(--text-primary)',margin:'0 0 14px',transform:'rotate(-.5deg)',display:'inline-block'}}>
            📑 Índice
          </h2>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:8}}>
            {SECCIONES.map(s=>(
              <a key={s.n} href={`#sec-${s.n}`} style={{
                fontFamily:HAND,fontSize:17,fontWeight:700,
                color:'var(--text-muted)',textDecoration:'none',
                padding:'4px 8px',borderRadius:6,
                transition:'all .2s',
              }}
                onMouseEnter={(e:any)=>{e.currentTarget.style.background='var(--bg-secondary)';e.currentTarget.style.color='var(--gold)';}}
                onMouseLeave={(e:any)=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-muted)';}}
              >
                {s.n}. {s.t}
              </a>
            ))}
          </div>
        </div>

        {/* Secciones */}
        {SECCIONES.map((s,i)=>(
          <section key={s.n} id={`sec-${s.n}`} style={{
            background:'var(--bg-card)',
            border:'2px solid var(--text-primary)',
            borderRadius:12,padding:'24px 26px',
            marginBottom:18,
            boxShadow:`3px 4px 0 ${i%2===0?'var(--gold)':'var(--blue)'}`,
            transform:`rotate(${i%2===0?-.2:.2}deg)`,
            scrollMarginTop:20,
          }}>
            <h2 style={{
              fontFamily:HAND,fontSize:32,fontWeight:900,
              color:'var(--text-primary)',margin:'0 0 12px',
              borderBottom:'2px dashed var(--border-color)',
              paddingBottom:8,
              transform:'rotate(-.5deg)',display:'inline-block',
            }}>
              {s.n}. {s.t}
            </h2>
            <p style={{
              fontFamily:'system-ui,sans-serif',fontSize:15,lineHeight:1.7,
              color:'var(--text-muted)',margin:0,
              whiteSpace:'pre-wrap',
            }}>
              {s.c}
            </p>
          </section>
        ))}

        {/* Footer */}
        <div style={{textAlign:'center',marginTop:40,padding:'20px'}}>
          <Link href="/" style={{
            display:'inline-block',
            fontFamily:HAND,fontSize:20,fontWeight:800,
            color:'var(--gold)',textDecoration:'none',
            padding:'10px 24px',
            border:'2.5px solid var(--gold)',borderRadius:10,
            boxShadow:'3px 4px 0 var(--gold)',
            transform:'rotate(-1deg)',
            transition:'all .25s',
          }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0) translateY(-2px)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';}}
          >
            ← volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}