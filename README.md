## Калькулятор вероятности потери данных в кластере Ceph/Vitastor

Установлен тут:

https://yourcmc.ru/afr-calc/

## А что такое Vitastor

Это мой быстрый цефозаменитель.

https://yourcmc.ru/git/vitalif/vitastor/

## Логика расчёта

- Вероятность потери данных равна вероятности того, что в течение года выйдет из строя любой 1 диск
  и при этом в течение времени, которое восстанавливается недостающая копия данных, выйдут из строя
  все оставшиеся диски любой из PG, бывших на указанном диске...
- ...Либо из строя выйдет целый хост и в течение времени его восстановления выйдут из строя оставшиеся
  диски любой из PG, бывших на одном из его дисков.
- Вероятность выхода из строя одной PG = (вероятность выхода из строя диска = P) ^ (N-1),
  где N - фактор репликации. Либо вероятность выхода из строя любых K из N-1 дисков в случае EC.
- Это не на 100% верно, т.к. за время восстановления первого диска выйти из строя может не N-1
  дисков, а, например, только 1, и тогда к исходному времени восстановления добавляется в среднем
  ещё какое-то время (в среднем 1/2 исходного, но в любом случае <= исходного), в течение которого
  первый диск уже будет восстановлен, но второй ещё не будет, и данные снова будут потеряны, если
  из строя выйдет N-1 других дисков. И если за это время опять выйдет из строя какой-то диск,
  то время опять будет продлено, в среднем уже на 3/4 исходного, и так может быть до бесконечности.
  Однако пока считаем, что этими величинами можно пренебречь, т.к. они обычно меньше исходной
  вероятности минимум на порядок, т.к. исходная - условно P^N, а "повторная" начинается от P^(N+1).
  Подлянка может ожидать нас в случае EC с неразумным N и вероятностью отказа (N >= 1/P) - исходная
  C(n,k) * P^(k+1), а "повторная" - C(n,1) * C(n,k+1) * P^(k+2).
- Все PG, бывшие на указанном диске, для упрощения мы считаем не имеющими других общих OSD. Это,
  естественно, не совсем корректно, так как в Ceph они, наоборот, почти гарантированно пересекаются.
  Однако, теоретически, вероятность выхода из строя любой из непересекающихся PG всегда выше, чем
  если бы какие-то из них пересекались, то есть у нас будет оценка сверху.
- Степень пересечения мы попробуем учесть через парадокс дней рождений, см. ниже.
- В таком случае события выхода из строя разных PG независимы и вероятность выхода из строя любой
  из K PG, имевших в своём составе отказавший диск, равна единице минус вероятность того, что ни
  одна из K PG не выйдет из строя, то есть, (1 - (1 - P^(N-1)) ^ K).
- Итого (Умерло) = (1 - (не умерло ни из-за диска, ни из-за хоста)) =
  (1 - (1 - (умерло из-за диска))^(общее число дисков) * (1 - (умерло из-за хоста))^(число хостов)).
- (Умерло из-за диска) = (Умер диск) * (1 - (не умерла ни одна из его PG)) =
  (Умер диск) * (1 - (1 - умерла PG)^(число PG)).
- (Умер диск) = ((AFR диска) + (AFR сервера)/(число дисков)) * (Время восстановления в годах).
  AFR сервера эмпирически поделен на число дисков, чтобы "размазать" вероятность отказа сервера
  по его дискам.

Парадоксы дней рождений:

- PG почти гарантированно пересекаются, особенно в небольших кластерах. Степень их пересечения
  очень полезно учитывать.
- Из задачи о парадоксе дней рождения мы знаем, что если в году N дней, а в группе K человек,
  то среднее число дней, являющихся хоть чьим-то днём рождения равно `U(N,K) = N*(1 - (1 - 1/N)^K)`.
  Это даёт нам возможность узнать, сколько в среднем уникальных элементов при K случайных выборах из N.
- На 1 диске в среднем размещается (число PG) групп чётности по (размер PG) дисков.
- 1 диск в среднем имеет примерно U((число хостов-1) * (число дисков), (число PG) * (размер PG - 1)) дисков,
  которые работают с ним в паре. Поделим это число на (размер PG - 1) и получим среднее число PG на диск с учётом пересечений.
- 1 хост в среднем имеет примерно U((число хостов-1) * (число дисков), (число дисков) * (число PG) * (размер PG - 1)) дисков,
  которые работают с ним в паре. Поделим это число на (размер PG - 1) и получим среднее число PG на сервер с учётом пересечений.
- При выходе из строя 1 диска и его мгновенной замене на другой все данные восстанавливаются на единственном
  новом заменном диске. В этом случае число дисков, участвующих в процессе восстановления - 1.
- При выходе из строя 1 диска без замены в Ceph по умолчанию его данные восстанавливаются на других дисках
  того же хоста. В этом случае число дисков, участвующих в процессе восстановления - U(число дисков-1, число PG).
- При выходе из строя 1 диска без замены в Vitastor или гипотетической иной системе его данные
  восстанавливаются на любых других дисках в кластере. В этом случае число дисков, участвующих в
  процессе восстановления - U((число хостов-1) * (число дисков), (число PG)).
- При выходе из строя целого хоста без возврата его дисков в строй в других хостах в восстановлении
  участвует U((число хостов-1) * (число дисков), (число дисков) * (число PG)) дисков.
- Зная число участвующих в восстановлении дисков, среднюю скорость восстановления в пересчёте на 1 диск,
  оцениваемую с учётом пропускной способности сети, а также объём дисков, мы можем рассчитать
  ожидаемое время восстановления данных одного диска или одного хоста.
